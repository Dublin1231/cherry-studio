import { performance } from 'perf_hooks'

interface CacheEntry<T> {
  data: T
  timestamp: number
  hits: number
}

interface CacheConfig {
  ttl: number // 缓存过期时间（毫秒）
  maxSize: number // 缓存最大条目数
  minHits: number // 最小命中次数，低于此值的条目可能被清除
}

export class QueryCache {
  private static instance: QueryCache
  private cache: Map<string, CacheEntry<any>>
  private config: CacheConfig
  private stats: {
    hits: number
    misses: number
    evictions: number
  }

  private constructor(config: Partial<CacheConfig> = {}) {
    this.cache = new Map()
    this.config = {
      ttl: config.ttl || 5 * 60 * 1000, // 默认5分钟
      maxSize: config.maxSize || 1000,
      minHits: config.minHits || 2
    }
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0
    }

    // 定期清理过期的缓存条目
    setInterval(() => this.cleanup(), this.config.ttl)
  }

  static getInstance(config?: Partial<CacheConfig>): QueryCache {
    if (!QueryCache.instance) {
      QueryCache.instance = new QueryCache(config)
    }
    return QueryCache.instance
  }

  async get<T>(key: string, queryFn: () => Promise<T>): Promise<T> {
    const cacheKey = this.generateKey(key)
    const cached = this.cache.get(cacheKey)

    // 如果缓存存在且未过期，返回缓存数据
    if (cached && !this.isExpired(cached)) {
      this.stats.hits++
      cached.hits++
      return cached.data
    }

    // 缓存不存在或已过期，执行查询
    this.stats.misses++
    const startTime = performance.now()
    const data = await queryFn()
    const queryTime = performance.now() - startTime

    // 如果查询耗时较长，将结果缓存以提高性能
    if (queryTime > 100) {
      // 100ms阈值
      this.set(cacheKey, data)
    }

    return data
  }

  private set<T>(key: string, data: T): void {
    // 如果缓存已满，清除使用频率最低的条目
    if (this.cache.size >= this.config.maxSize) {
      this.evictLeastUsed()
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      hits: 1
    })
  }

  private generateKey(key: string): string {
    return `cache:${key}`
  }

  private isExpired(entry: CacheEntry<any>): boolean {
    return Date.now() - entry.timestamp > this.config.ttl
  }

  private evictLeastUsed(): void {
    let leastUsedKey: string | null = null
    let leastHits = Infinity

    for (const [key, entry] of this.cache.entries()) {
      if (entry.hits < leastHits) {
        leastHits = entry.hits
        leastUsedKey = key
      }
    }

    if (leastUsedKey && leastHits < this.config.minHits) {
      this.cache.delete(leastUsedKey)
      this.stats.evictions++
    }
  }

  private cleanup(): void {
    const now = Date.now()
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.config.ttl) {
        this.cache.delete(key)
        this.stats.evictions++
      }
    }
  }

  // 获取缓存统计信息
  getStats() {
    return {
      ...this.stats,
      size: this.cache.size,
      hitRate: this.stats.hits / (this.stats.hits + this.stats.misses)
    }
  }

  // 清空所有缓存
  clear(): void {
    this.cache.clear()
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0
    }
  }

  // 使指定键的缓存失效
  invalidate(key: string): void {
    const cacheKey = this.generateKey(key)
    this.cache.delete(cacheKey)
  }

  // 使匹配模式的缓存失效
  invalidateMany(pattern: RegExp): void {
    for (const key of this.cache.keys()) {
      if (pattern.test(key)) {
        this.cache.delete(key)
      }
    }
  }
}

// 导出单例实例
export const queryCache = QueryCache.getInstance()
