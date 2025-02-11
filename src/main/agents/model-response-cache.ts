import { createHash } from 'crypto'
import { EventEmitter } from 'events'

interface CacheConfig {
  ttl: number // 缓存过期时间(毫秒)
  maxSize: number // 最大缓存条目数
  minHits: number // 最小命中次数
}

interface CacheEntry {
  response: string
  timestamp: number
  hits: number
  params: string // 序列化的生成参数
  modelId: string
}

interface CacheStats {
  hits: number
  misses: number
  size: number
  hitRate: number
}

export class ModelResponseCache extends EventEmitter {
  private static instance: ModelResponseCache
  private cache: Map<string, CacheEntry> = new Map()
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    size: 0,
    hitRate: 0
  }

  private readonly DEFAULT_CONFIG: CacheConfig = {
    ttl: 24 * 60 * 60 * 1000, // 24小时
    maxSize: 1000,
    minHits: 2
  }

  private constructor(private config: Partial<CacheConfig> = {}) {
    super()
    this.config = { ...this.DEFAULT_CONFIG, ...config } as CacheConfig
    this.startCleanupInterval()
  }

  static getInstance(config?: Partial<CacheConfig>): ModelResponseCache {
    if (!ModelResponseCache.instance) {
      ModelResponseCache.instance = new ModelResponseCache(config)
    }
    return ModelResponseCache.instance
  }

  async get(modelId: string, prompt: string, params: any): Promise<string | null> {
    const key = this.generateKey(modelId, prompt, params)
    const entry = this.cache.get(key)

    if (!entry) {
      this.stats.misses++
      this.updateHitRate()
      return null
    }

    if (this.isExpired(entry)) {
      this.cache.delete(key)
      this.stats.misses++
      this.updateHitRate()
      return null
    }

    entry.hits++
    this.stats.hits++
    this.updateHitRate()

    this.emit('cache:hit', {
      modelId,
      prompt,
      hits: entry.hits
    })

    return entry.response
  }

  set(modelId: string, prompt: string, params: any, response: string): void {
    const key = this.generateKey(modelId, prompt, params)

    const maxSize = this.config?.maxSize ?? this.DEFAULT_CONFIG.maxSize
    if (this.cache.size >= maxSize) {
      this.evictLeastUsed()
    }

    this.cache.set(key, {
      response,
      timestamp: Date.now(),
      hits: 1,
      params: JSON.stringify(params),
      modelId
    })

    this.stats.size = this.cache.size

    this.emit('cache:set', {
      modelId,
      prompt,
      cacheSize: this.cache.size
    })
  }

  private generateKey(modelId: string, prompt: string, params: any): string {
    const data = `${modelId}:${prompt}:${JSON.stringify(params)}`
    return createHash('sha256').update(data).digest('hex')
  }

  private isExpired(entry: CacheEntry): boolean {
    const ttl = this.config?.ttl ?? this.DEFAULT_CONFIG.ttl
    return Date.now() - entry.timestamp > ttl
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

    if (leastUsedKey) {
      this.cache.delete(leastUsedKey)
      this.emit('cache:evict', { key: leastUsedKey })
    }
  }

  private startCleanupInterval(): void {
    setInterval(
      () => {
        const minHits = this.config?.minHits ?? this.DEFAULT_CONFIG.minHits
        for (const [key, entry] of this.cache.entries()) {
          if (this.isExpired(entry) || entry.hits < minHits) {
            this.cache.delete(key)
            this.emit('cache:cleanup', { key })
          }
        }
        this.stats.size = this.cache.size
      },
      60 * 60 * 1000
    ) // 每小时清理一次
  }

  private updateHitRate(): void {
    const total = this.stats.hits + this.stats.misses
    this.stats.hitRate = total > 0 ? this.stats.hits / total : 0
  }

  getStats(): CacheStats {
    return { ...this.stats }
  }

  clear(): void {
    this.cache.clear()
    this.stats = {
      hits: 0,
      misses: 0,
      size: 0,
      hitRate: 0
    }
    this.emit('cache:clear')
  }
}

export const modelResponseCache = ModelResponseCache.getInstance()
