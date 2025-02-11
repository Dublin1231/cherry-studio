import { EventEmitter } from 'events'

interface CacheEntry<T> {
  value: T
  expiry: number
}

export class CacheManager extends EventEmitter {
  private cache: Map<string, CacheEntry<any>>
  private cleanupInterval: NodeJS.Timeout

  constructor() {
    super()
    this.cache = new Map()
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000) // 每分钟清理一次过期缓存
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.cache.get(key)
    if (!entry) return null

    if (entry.expiry < Date.now()) {
      this.cache.delete(key)
      return null
    }

    return entry.value
  }

  async set<T>(key: string, value: T, ttl: number): Promise<void> {
    const expiry = Date.now() + ttl * 1000
    this.cache.set(key, { value, expiry })
  }

  async delete(key: string): Promise<boolean> {
    return this.cache.delete(key)
  }

  async clear(): Promise<void> {
    this.cache.clear()
  }

  async has(key: string): Promise<boolean> {
    const entry = this.cache.get(key)
    if (!entry) return false

    if (entry.expiry < Date.now()) {
      this.cache.delete(key)
      return false
    }

    return true
  }

  async keys(): Promise<string[]> {
    return Array.from(this.cache.keys())
  }

  async size(): Promise<number> {
    return this.cache.size
  }

  private cleanup(): void {
    const now = Date.now()
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiry < now) {
        this.cache.delete(key)
      }
    }
  }

  destroy(): void {
    clearInterval(this.cleanupInterval)
    this.cache.clear()
  }
}

export const cacheManager = new CacheManager()
