import { EventEmitter } from 'events'
import { PrismaClient, MemoryAnchor } from '@prisma/client'

interface RetrievalConfig {
  maxResults: number
  minRelevance: number
  useEmbeddings: boolean
  useCaching: boolean
  timeout: number
}

interface RetrievalResult {
  memories: MemoryAnchor[]
  totalCount: number
  relevanceScores: number[]
  retrievalTime: number
}

interface RetrievalStats {
  totalQueries: number
  averageTime: number
  cacheHitRate: number
  topCategories: string[]
}

export class MemoryRetriever extends EventEmitter {
  private static instance: MemoryRetriever
  private prisma: PrismaClient
  private config: RetrievalConfig
  private cache: Map<string, RetrievalResult>
  private stats: RetrievalStats

  private constructor() {
    super()
    this.prisma = new PrismaClient()
    this.config = {
      maxResults: 10,
      minRelevance: 0.5,
      useEmbeddings: true,
      useCaching: true,
      timeout: 5000
    }
    this.cache = new Map()
    this.stats = {
      totalQueries: 0,
      averageTime: 0,
      cacheHitRate: 0,
      topCategories: []
    }
  }

  static getInstance(): MemoryRetriever {
    if (!MemoryRetriever.instance) {
      MemoryRetriever.instance = new MemoryRetriever()
    }
    return MemoryRetriever.instance
  }

  // 根据查询检索记忆
  async retrieveMemories(query: string, options?: Partial<RetrievalConfig>): Promise<RetrievalResult> {
    const startTime = Date.now()
    const config = { ...this.config, ...options }
    
    // 检查缓存
    if (config.useCaching) {
      const cached = this.cache.get(query)
      if (cached) {
        this.updateStats('cache_hit')
        return cached
      }
    }

    try {
      // 使用向量检索
      let memories: MemoryAnchor[] = []
      let relevanceScores: number[] = []

      if (config.useEmbeddings) {
        const results = await this.vectorSearch(query, config.maxResults)
        memories = results.memories
        relevanceScores = results.scores
      } else {
        // 使用关键词检索
        memories = await this.keywordSearch(query, config.maxResults)
        relevanceScores = memories.map(() => 1.0)
      }

      // 过滤低相关性结果
      memories = memories.filter((_, i) => relevanceScores[i] >= config.minRelevance)
      relevanceScores = relevanceScores.filter(score => score >= config.minRelevance)

      const result: RetrievalResult = {
        memories,
        totalCount: memories.length,
        relevanceScores,
        retrievalTime: Date.now() - startTime
      }

      // 更新缓存
      if (config.useCaching) {
        this.cache.set(query, result)
      }

      this.updateStats('query_complete', result)
      return result
    } catch (error) {
      this.emit('retrieval_error', error)
      throw error
    }
  }

  // 向量检索
  private async vectorSearch(query: string, limit: number): Promise<{
    memories: MemoryAnchor[]
    scores: number[]
  }> {
    // TODO: 实现向量检索逻辑
    return {
      memories: [],
      scores: []
    }
  }

  // 关键词检索
  private async keywordSearch(query: string, limit: number): Promise<MemoryAnchor[]> {
    return this.prisma.memoryAnchor.findMany({
      where: {
        OR: [
          { content: { contains: query } },
          { type: { contains: query } }
        ]
      },
      take: limit,
      orderBy: { weight: 'desc' }
    })
  }

  // 获取相关记忆
  async getRelatedMemories(memoryId: string, limit: number = 5): Promise<MemoryAnchor[]> {
    const memory = await this.prisma.memoryAnchor.findUnique({
      where: { id: memoryId },
      include: {
        relations: {
          include: {
            target: true
          }
        },
        relatedTo: {
          include: {
            source: true
          }
        }
      }
    })

    if (!memory) {
      throw new Error(`Memory with id ${memoryId} not found`)
    }

    // 收集所有相关记忆
    const related = new Set<MemoryAnchor>()
    
    // 添加直接关联的记忆
    memory.relations.forEach(relation => related.add(relation.target))
    memory.relatedTo.forEach(relation => related.add(relation.source))

    // 转换为数组并限制数量
    return Array.from(related).slice(0, limit)
  }

  // 更新检索统计
  private updateStats(event: 'cache_hit' | 'query_complete', result?: RetrievalResult): void {
    this.stats.totalQueries++

    if (event === 'cache_hit') {
      this.stats.cacheHitRate = 
        (this.stats.cacheHitRate * (this.stats.totalQueries - 1) + 1) / 
        this.stats.totalQueries
    } else if (result) {
      // 更新平均检索时间
      this.stats.averageTime = 
        (this.stats.averageTime * (this.stats.totalQueries - 1) + result.retrievalTime) / 
        this.stats.totalQueries

      // 更新热门分类
      const categories = result.memories.map(m => m.type)
      this.updateTopCategories(categories)
    }

    this.emit('stats_updated', this.stats)
  }

  // 更新热门分类
  private updateTopCategories(categories: string[]): void {
    const categoryCount = new Map<string, number>()
    
    // 统计类别出现次数
    categories.forEach(category => {
      categoryCount.set(category, (categoryCount.get(category) || 0) + 1)
    })

    // 排序并更新热门分类
    this.stats.topCategories = Array.from(categoryCount.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([category]) => category)
      .slice(0, 5)
  }

  // 清除缓存
  clearCache(): void {
    this.cache.clear()
    this.emit('cache_cleared')
  }

  // 获取统计信息
  getStats(): RetrievalStats {
    return this.stats
  }

  // 更新配置
  setConfig(config: Partial<RetrievalConfig>): void {
    this.config = { ...this.config, ...config }
    this.emit('config_updated', this.config)
  }

  // 获取配置
  getConfig(): RetrievalConfig {
    return this.config
  }

  // 关闭连接
  async disconnect(): Promise<void> {
    await this.prisma.$disconnect()
  }
}

// 导出单例实例
export const memoryRetriever = MemoryRetriever.getInstance() 