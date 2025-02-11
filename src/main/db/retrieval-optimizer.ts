import { DataType } from '@zilliz/milvus2-sdk-node'
import { EventEmitter } from 'events'

import { CacheManager } from '../utils/cache-manager'
import { milvus } from './milvus'
import { PerformanceMonitor } from './performance-monitor'
import { prisma } from './prisma'

interface RetrievalConfig {
  useCache: boolean
  cacheTTL: number
  maxResults: number
  minScore: number
  useMultiModal: boolean
  modalityWeights: {
    text: number
    semantic: number
    image?: number
  }
}

interface SearchResult {
  id: string
  score: number
  content: any
  type: string
  metadata: Record<string, any>
}

interface SearchStats {
  totalTime: number
  cacheHits: number
  cacheMisses: number
  vectorSearchTime: number
  postProcessingTime: number
}

export class RetrievalOptimizer extends EventEmitter {
  private static instance: RetrievalOptimizer
  private performanceMonitor: PerformanceMonitor
  private cacheManager: CacheManager

  private readonly DEFAULT_CONFIG: RetrievalConfig = {
    useCache: true,
    cacheTTL: 3600,
    maxResults: 100,
    minScore: 0.7,
    useMultiModal: true,
    modalityWeights: {
      text: 0.4,
      semantic: 0.6
    }
  }

  private constructor() {
    super()
    this.performanceMonitor = PerformanceMonitor.getInstance()
    this.cacheManager = new CacheManager()
  }

  static getInstance(): RetrievalOptimizer {
    if (!RetrievalOptimizer.instance) {
      RetrievalOptimizer.instance = new RetrievalOptimizer()
    }
    return RetrievalOptimizer.instance
  }

  async search(
    query: string,
    config: Partial<RetrievalConfig> = {}
  ): Promise<{ results: SearchResult[]; stats: SearchStats }> {
    const startTime = Date.now()
    const finalConfig = { ...this.DEFAULT_CONFIG, ...config }
    const stats: SearchStats = {
      totalTime: 0,
      cacheHits: 0,
      cacheMisses: 0,
      vectorSearchTime: 0,
      postProcessingTime: 0
    }

    // 检查缓存
    if (finalConfig.useCache) {
      const cacheKey = this.generateCacheKey(query, finalConfig)
      const cachedResults = await this.cacheManager.get<SearchResult[]>(cacheKey)
      if (cachedResults) {
        stats.cacheHits++
        stats.totalTime = Date.now() - startTime
        return { results: cachedResults, stats }
      }
      stats.cacheMisses++
    }

    // 执行多模态检索
    const vectorSearchStart = Date.now()
    const [vectorResults, textResults, semanticResults] = await Promise.all([
      this.performVectorSearch(query, finalConfig),
      this.performTextSearch(query),
      this.performSemanticSearch(query)
    ])
    stats.vectorSearchTime = Date.now() - vectorSearchStart

    const postProcessStart = Date.now()
    // 应用权重并合并结果
    const weightedResults = this.mergeResults(
      [
        ...this.applyWeight(vectorResults, finalConfig.modalityWeights.text),
        ...this.applyWeight(textResults, finalConfig.modalityWeights.text),
        ...this.applyWeight(semanticResults, finalConfig.modalityWeights.semantic)
      ],
      finalConfig
    )

    // 过滤低分结果并限制数量
    const finalResults = weightedResults.filter((r) => r.score >= finalConfig.minScore).slice(0, finalConfig.maxResults)

    stats.postProcessingTime = Date.now() - postProcessStart
    stats.totalTime = Date.now() - startTime

    // 缓存结果
    if (finalConfig.useCache) {
      const cacheKey = this.generateCacheKey(query, finalConfig)
      await this.cacheManager.set(cacheKey, finalResults, finalConfig.cacheTTL)
    }

    return { results: finalResults, stats }
  }

  private async performVectorSearch(query: string, config: RetrievalConfig): Promise<SearchResult[]> {
    const embedding = await this.generateEmbedding(query)
    const searchParams = {
      collection_name: 'memory_anchors',
      vectors: [embedding],
      vector_type: DataType.FloatVector,
      limit: config.maxResults * 2 // 获取更多结果用于后续合并
    }

    const results = await milvus.search(searchParams)
    return (results || []).map((r: any) => ({
      id: r.id,
      score: r.score,
      content: r.content,
      type: 'vector',
      metadata: r.metadata || {}
    }))
  }

  private async performTextSearch(query: string): Promise<SearchResult[]> {
    // 使用全文搜索
    const results = await prisma.memoryAnchor.findMany({
      where: {
        content: { contains: query }
      },
      take: 50
    })

    return results.map((r) => ({
      id: r.id,
      score: 1.0, // 精确匹配得分
      content: r.content,
      type: 'text',
      metadata: { novelId: r.novelId, chapterId: r.chapterId }
    }))
  }

  private async performSemanticSearch(query: string): Promise<SearchResult[]> {
    const embedding = await this.generateEmbedding(query)
    const searchParams = {
      collection_name: 'semantic_index',
      vectors: [embedding],
      vector_type: DataType.FloatVector,
      limit: 50
    }

    const results = await milvus.search(searchParams)
    return (results || []).map((r: any) => ({
      id: r.id,
      score: r.score,
      content: r.content,
      type: 'semantic',
      metadata: r.metadata || {}
    }))
  }

  private applyWeight(results: SearchResult[], weight: number): SearchResult[] {
    return results.map((r) => ({
      ...r,
      score: r.score * weight
    }))
  }

  private mergeResults(results: SearchResult[], config: RetrievalConfig): SearchResult[] {
    // 按ID分组，合并分数
    const merged = new Map<string, SearchResult>()

    for (const result of results) {
      if (merged.has(result.id)) {
        const existing = merged.get(result.id)!
        merged.set(result.id, {
          ...existing,
          score: Math.max(existing.score, result.score)
        })
      } else {
        merged.set(result.id, result)
      }
    }

    // 转换回数组并排序
    return Array.from(merged.values()).sort((a, b) => b.score - a.score)
  }

  private async generateEmbedding(text: string): Promise<number[]> {
    // 这里应该调用实际的嵌入生成服务
    // 目前返回模拟的向量
    return new Array(128).fill(0).map(() => Math.random())
  }

  private generateCacheKey(query: string, config: RetrievalConfig): string {
    return `search:${query}:${JSON.stringify(config)}`
  }

  async optimizeIndexes(): Promise<void> {
    // 优化 Milvus 索引
    await milvus.createIndex({
      collection_name: 'memory_anchors',
      field_name: 'embedding',
      index_type: 'IVF_SQ8',
      metric_type: 'L2',
      params: { nlist: 1024 }
    })

    // 优化数据库索引
    await prisma.$executeRaw`
      CREATE INDEX IF NOT EXISTS idx_memory_anchors_content ON memory_anchors USING GIN (content gin_trgm_ops);
    `
  }

  async analyzePerformance(): Promise<any> {
    return this.performanceMonitor.getMetrics()
  }

  async clearCache(): Promise<void> {
    await this.cacheManager.clear()
  }
}

// 导出单例实例
export const retrievalOptimizer = RetrievalOptimizer.getInstance()
