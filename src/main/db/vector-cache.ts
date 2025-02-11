import { EventEmitter } from 'events'
import { LRUCache } from 'lru-cache'

interface CacheConfig {
  maxSize: number // 最大缓存大小(MB)
  maxAge?: number // 最大缓存时间(毫秒)
  updateAgeOnGet?: boolean // 是否在获取时更新年龄
  allowStale: boolean // 是否允许返回过期数据
}

interface CacheMetrics {
  hits: number
  misses: number
  size: number
  usage: number
  evictions: number
}

interface CacheEntry {
  vector?: number[]
  compressed?: Uint8Array
  metadata?: Record<string, unknown>
  lastAccessed?: Date
}

interface CacheEvictEvent {
  cacheName: string
  key: string
  size: number
}

export class VectorCache extends EventEmitter {
  private static instance: VectorCache
  private caches: Map<string, LRUCache<string, CacheEntry>> = new Map()
  private metrics: Map<string, CacheMetrics> = new Map()
  private compressionEnabled: boolean = true
  private compressionThreshold: number = 1024 // 向量维度超过此值时启用压缩
  private configs: Map<string, CacheConfig> = new Map()

  private readonly DEFAULT_CONFIG: CacheConfig = {
    maxSize: 1024, // 1GB
    maxAge: 3600000, // 1小时
    updateAgeOnGet: true,
    allowStale: false
  }

  private constructor() {
    super()
  }

  static getInstance(): VectorCache {
    if (!VectorCache.instance) {
      VectorCache.instance = new VectorCache()
    }
    return VectorCache.instance
  }

  createCache(cacheName: string, config?: Partial<CacheConfig>): void {
    const finalConfig = { ...this.DEFAULT_CONFIG, ...config }
    this.configs.set(cacheName, finalConfig)

    const cache = new LRUCache<string, CacheEntry>({
      max: finalConfig.maxSize,
      ttl: finalConfig.maxAge,
      updateAgeOnGet: finalConfig.updateAgeOnGet,
      allowStale: finalConfig.allowStale,
      dispose: (value: CacheEntry, key: string) => {
        this.onEntryEvicted(cacheName, key, value)
      }
    })

    this.caches.set(cacheName, cache)
    this.metrics.set(cacheName, {
      hits: 0,
      misses: 0,
      size: 0,
      usage: 0,
      evictions: 0
    })

    this.emit('cache_created', { name: cacheName, config: finalConfig })
  }

  async set(cacheName: string, key: string, vector: number[], metadata?: Record<string, unknown>): Promise<void> {
    const cache = this.caches.get(cacheName)
    if (!cache) {
      throw new Error(`Cache ${cacheName} not found`)
    }

    const entry: CacheEntry = {
      vector,
      metadata,
      lastAccessed: new Date()
    }

    // 对大向量进行压缩
    if (this.compressionEnabled && vector.length > this.compressionThreshold) {
      entry.compressed = await this.compressVector(vector)
    }

    cache.set(key, entry)
    this.updateMetrics(cacheName, 'set', vector.length)
    this.emit('cache_set', { cacheName, key, size: vector.length })
  }

  get(cacheName: string, key: string): CacheEntry | undefined {
    const cache = this.caches.get(cacheName)
    if (!cache) {
      throw new Error(`Cache ${cacheName} not found`)
    }

    const entry = cache.get(key)
    if (entry) {
      entry.lastAccessed = new Date()
      this.updateMetrics(cacheName, 'hit')
      this.emit('cache_hit', { cacheName, key })
    } else {
      this.updateMetrics(cacheName, 'miss')
      this.emit('cache_miss', { cacheName, key })
    }

    return entry
  }

  async getVector(cacheName: string, key: string): Promise<number[] | undefined> {
    const entry = this.get(cacheName, key)
    if (!entry) return undefined

    // 如果存在压缩数据,进行解压
    if (entry.compressed) {
      return await this.decompressVector(entry.compressed)
    }

    return entry.vector
  }

  delete(cacheName: string, key: string): boolean {
    const cache = this.caches.get(cacheName)
    if (!cache) {
      return false
    }

    const entry = cache.get(key)
    if (!entry) {
      return false
    }

    const result = cache.delete(key)
    if (result && entry.vector) {
      const metrics = this.metrics.get(cacheName)
      if (metrics) {
        metrics.evictions++
        metrics.size = Math.max(0, metrics.size - entry.vector.length * 4)
        metrics.usage = (metrics.size / this.DEFAULT_CONFIG.maxSize) * 100
      }
      this.emit('cache_evict', { cacheName, key, size: entry.vector.length } as CacheEvictEvent)
    }
    return result
  }

  clear(cacheName: string): void {
    const cache = this.caches.get(cacheName)
    if (cache) {
      cache.clear()
      const metrics = this.metrics.get(cacheName)
      if (metrics) {
        metrics.size = 0
        metrics.usage = 0
        metrics.evictions = 0
      }
    }
    this.resetMetrics(cacheName)
    this.emit('cache_clear', { cacheName })
  }

  setCompressionEnabled(enabled: boolean): void {
    this.compressionEnabled = enabled
  }

  setCompressionThreshold(threshold: number): void {
    if (threshold > 0) {
      this.compressionThreshold = threshold
    }
  }

  private getCache(name: string): LRUCache<string, CacheEntry> | undefined {
    return this.caches.get(name)
  }

  private calculateMaxItems(maxSizeMB: number): number {
    // 假设每个向量平均100维,每个数占4字节
    const averageItemSize = 100 * 4 // bytes
    return Math.floor((maxSizeMB * 1024 * 1024) / averageItemSize)
  }

  private updateMetrics(cacheName: string, operation: 'hit' | 'miss' | 'set', vectorSize?: number): void {
    const metrics = this.metrics.get(cacheName)
    if (!metrics) return

    switch (operation) {
      case 'hit':
        metrics.hits++
        break
      case 'miss':
        metrics.misses++
        break
      case 'set':
        if (vectorSize) {
          metrics.size += vectorSize * 4 // 假设每个浮点数占用 4 字节
          metrics.usage = (metrics.size / this.DEFAULT_CONFIG.maxSize) * 100
        }
        break
    }
  }

  private resetMetrics(cacheName: string): void {
    this.metrics.set(cacheName, {
      hits: 0,
      misses: 0,
      size: 0,
      usage: 0,
      evictions: 0
    })
  }

  private onEntryEvicted(cacheName: string, key: string, value: CacheEntry): void {
    const metrics = this.metrics.get(cacheName)
    if (metrics && value.vector) {
      metrics.evictions++
      metrics.size = Math.max(0, metrics.size - value.vector.length * 4)
      metrics.usage = (metrics.size / this.DEFAULT_CONFIG.maxSize) * 100
    }
    this.emit('cache_evict', {
      cacheName,
      key,
      size: value.vector?.length || 0
    } as CacheEvictEvent)
  }

  private async compressVector(vector: number[]): Promise<Uint8Array> {
    // 简单的压缩实现:将float32转换为int8
    const compressed = new Uint8Array(vector.length)
    for (let i = 0; i < vector.length; i++) {
      compressed[i] = Math.round((vector[i] + 1) * 127.5) // 假设向量值在[-1,1]范围内
    }
    return compressed
  }

  private async decompressVector(compressed: Uint8Array): Promise<number[]> {
    // 解压缩:将int8转换回float32
    const vector = new Array(compressed.length)
    for (let i = 0; i < compressed.length; i++) {
      vector[i] = compressed[i] / 127.5 - 1
    }
    return vector
  }

  getMetrics(cacheName: string): CacheMetrics | undefined {
    return this.metrics.get(cacheName)
  }

  getAllMetrics(): Map<string, CacheMetrics> {
    return new Map(this.metrics)
  }

  getCacheNames(): string[] {
    return Array.from(this.caches.keys())
  }

  getCacheConfig(cacheName: string): CacheConfig | undefined {
    return this.configs.get(cacheName)
  }

  /**
   * 将缓存大小裁剪到指定大小
   * @param targetSize 目标大小（MB）
   */
  async trim(targetSize: number): Promise<void> {
    const currentSize = this.calculateTotalSize()
    if (currentSize <= targetSize) return

    // 按照最近最少使用原则删除缓存项
    const cacheNames = this.getCacheNames()
    for (const cacheName of cacheNames) {
      const cache = this.caches.get(cacheName)
      if (!cache) continue

      // 获取所有缓存项并按访问时间排序
      const entries = Array.from(cache.entries())
        .sort((a: [string, CacheEntry], b: [string, CacheEntry]) => {
          const timeA = a[1].lastAccessed?.getTime() || 0
          const timeB = b[1].lastAccessed?.getTime() || 0
          return timeA - timeB
        })

      // 逐个删除最旧的缓存项，直到达到目标大小
      for (const [key] of entries) {
        if (this.calculateTotalSize() <= targetSize) break
        this.delete(cacheName, key)
      }
    }
  }

  /**
   * 获取指定缓存的队列长度
   * @param cacheName 缓存名称
   * @returns 队列长度
   */
  getQueueLength(cacheName: string): number {
    const cache = this.caches.get(cacheName)
    return cache ? cache.size : 0
  }

  /**
   * 计算当前总缓存大小（MB）
   */
  private calculateTotalSize(): number {
    let totalSize = 0
    for (const metrics of this.metrics.values()) {
      totalSize += metrics.size
    }
    return totalSize
  }
}

export const vectorCache = VectorCache.getInstance()
