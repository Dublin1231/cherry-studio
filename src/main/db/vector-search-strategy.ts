import { DataType } from '@zilliz/milvus2-sdk-node'
import { EventEmitter } from 'events'

import { errorHandler } from './error-handler'
import { milvus } from './milvus'
import { performanceMonitor } from './performance-monitor'

interface SearchStrategy {
  name: string
  description: string
  params: {
    nprobe?: number // IVF 探针数
    ef?: number // HNSW 搜索宽度
    metric_type: 'L2' | 'IP' | 'COSINE'
    search_k?: number // ANNOY 搜索次数
    min_score: number
  }
  conditions: {
    collectionSize?: number
    dimension?: number
    qps?: number
    latencyThreshold?: number
  }
}

interface SearchResult {
  id: string
  distance: number
  score: number
  metadata?: Record<string, any>
}

interface SearchMetrics {
  latency: number
  throughput: number
  accuracy: number
  recall: number
  failureRate: number
}

export class VectorSearchStrategy extends EventEmitter {
  private static instance: VectorSearchStrategy
  private strategies: Map<string, SearchStrategy> = new Map()
  private metrics: Map<string, SearchMetrics> = new Map()

  private constructor() {
    super()
    this.initializeStrategies()
  }

  static getInstance(): VectorSearchStrategy {
    if (!VectorSearchStrategy.instance) {
      VectorSearchStrategy.instance = new VectorSearchStrategy()
    }
    return VectorSearchStrategy.instance
  }

  private initializeStrategies() {
    // IVF_FLAT 策略 - 适用于中小规模数据集
    this.strategies.set('ivf_flat', {
      name: 'IVF_FLAT',
      description: '基于倒排索引的精确搜索策略',
      params: {
        nprobe: 16,
        metric_type: 'L2',
        min_score: 0.8
      },
      conditions: {
        collectionSize: 1000000,
        dimension: 128,
        qps: 100,
        latencyThreshold: 10
      }
    })

    // HNSW 策略 - 适用于需要高性能的场景
    this.strategies.set('hnsw', {
      name: 'HNSW',
      description: '基于层次化小世界图的高性能搜索策略',
      params: {
        ef: 64,
        metric_type: 'COSINE',
        min_score: 0.75
      },
      conditions: {
        collectionSize: 10000000,
        dimension: 256,
        qps: 1000,
        latencyThreshold: 5
      }
    })

    // IVF_SQ8 策略 - 适用于大规模数据集
    this.strategies.set('ivf_sq8', {
      name: 'IVF_SQ8',
      description: '带有标量量化的倒排索引搜索策略',
      params: {
        nprobe: 32,
        metric_type: 'IP',
        min_score: 0.7
      },
      conditions: {
        collectionSize: 50000000,
        dimension: 512,
        qps: 500,
        latencyThreshold: 20
      }
    })
  }

  async search(
    collectionName: string,
    vector: number[],
    options: {
      strategy?: string
      topK?: number
      params?: Partial<SearchStrategy['params']>
    } = {}
  ): Promise<SearchResult[]> {
    const startTime = Date.now()
    try {
      const strategy = await this.selectStrategy(collectionName, vector.length, options.strategy)
      const searchParams = this.buildSearchParams(strategy, vector, options)

      const searchResponse = await milvus.search({
        collection_name: collectionName,
        vectors: [vector],
        vector_type: DataType.FloatVector,
        ...searchParams
      })

      const results = Array.isArray(searchResponse) ? searchResponse : []
      const processedResults = this.processResults(results, strategy.params.min_score)

      this.updateMetrics(strategy.name, {
        latency: Date.now() - startTime,
        throughput: 1,
        accuracy: this.calculateAccuracy(processedResults),
        recall: this.calculateRecall(processedResults),
        failureRate: 0
      })

      return processedResults
    } catch (error) {
      this.handleSearchError(error as Error, collectionName)
      throw error
    }
  }

  private async selectStrategy(
    collectionName: string,
    dimension: number,
    preferredStrategy?: string
  ): Promise<SearchStrategy> {
    if (preferredStrategy && this.strategies.has(preferredStrategy)) {
      return this.strategies.get(preferredStrategy)!
    }

    const collectionInfo = await milvus.showCollections({
      collection_names: [collectionName]
    })

    const collectionSize = collectionInfo?.data?.[0]?.rowCount || 0

    let bestStrategy: SearchStrategy | undefined
    let bestScore = -1

    for (const strategy of this.strategies.values()) {
      const score = this.evaluateStrategyFitness(strategy, {
        collectionSize,
        dimension,
        qps: this.getCurrentQPS(collectionName)
      })

      if (score > bestScore) {
        bestScore = score
        bestStrategy = strategy
      }
    }

    if (!bestStrategy) {
      throw new Error('无法找到合适的搜索策略')
    }

    return bestStrategy
  }

  private buildSearchParams(
    strategy: SearchStrategy,
    vector: number[],
    options: {
      topK?: number
      params?: Partial<SearchStrategy['params']>
    }
  ): any {
    return {
      metric_type: strategy.params.metric_type,
      params: {
        nprobe: options.params?.nprobe || strategy.params.nprobe,
        ef: options.params?.ef || strategy.params.ef,
        search_k: options.params?.search_k || strategy.params.search_k
      },
      limit: options.topK || 10
    }
  }

  private processResults(results: any[], minScore: number): SearchResult[] {
    return results
      .filter((result) => result.score >= minScore)
      .map((result) => ({
        id: result.id,
        distance: result.distance,
        score: result.score,
        metadata: result.metadata
      }))
  }

  private evaluateStrategyFitness(
    strategy: SearchStrategy,
    conditions: {
      collectionSize: number
      dimension: number
      qps: number
    }
  ): number {
    let score = 0

    // 评估集合大小适配度
    if (strategy.conditions.collectionSize) {
      score += Math.min(conditions.collectionSize / strategy.conditions.collectionSize, 1) * 0.4
    }

    // 评估维度适配度
    if (strategy.conditions.dimension) {
      score += Math.min(conditions.dimension / strategy.conditions.dimension, 1) * 0.3
    }

    // 评估 QPS 适配度
    if (strategy.conditions.qps) {
      score += Math.min(conditions.qps / strategy.conditions.qps, 1) * 0.3
    }

    return score
  }

  private getCurrentQPS(collectionName: string): number {
    const metrics = performanceMonitor.getMetrics('vector_search') || {}
    const searchMetrics = metrics[collectionName]
    if (!searchMetrics?.count) return 0
    return searchMetrics.count / (60 * 1000) // 转换为每秒查询数
  }

  private calculateAccuracy(results: SearchResult[]): number {
    // 简单实现:根据结果分数评估准确性
    if (results.length === 0) return 0
    return results.reduce((sum, result) => sum + result.score, 0) / results.length
  }

  private calculateRecall(results: SearchResult[]): number {
    // 简单实现:使用结果数量与期望数量的比率
    return results.length > 0 ? 1 : 0
  }

  private updateMetrics(strategyName: string, metrics: SearchMetrics) {
    this.metrics.set(strategyName, metrics)
    this.emit('metrics_updated', { strategy: strategyName, metrics })
  }

  private handleSearchError(error: Error, collectionName: string) {
    errorHandler.handleError(error, {
      context: 'vector_search',
      collection: collectionName
    })

    // 更新失败率指标
    const metrics = this.metrics.get(collectionName) || {
      latency: 0,
      throughput: 0,
      accuracy: 0,
      recall: 0,
      failureRate: 0
    }
    metrics.failureRate = (metrics.failureRate * 9 + 1) / 10 // 使用移动平均值
    this.metrics.set(collectionName, metrics)
  }

  getMetrics(collectionName: string): SearchMetrics | undefined {
    return this.metrics.get(collectionName)
  }

  getAllMetrics(): Map<string, SearchMetrics> {
    return new Map(this.metrics)
  }

  clearMetrics(collectionName?: string) {
    if (collectionName) {
      this.metrics.delete(collectionName)
    } else {
      this.metrics.clear()
    }
  }
}

export const vectorSearchStrategy = VectorSearchStrategy.getInstance()
