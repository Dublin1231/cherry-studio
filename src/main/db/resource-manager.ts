import { EventEmitter } from 'events'

import { VectorCache } from './vector-cache'
import { VectorCompressor } from './vector-compressor'
import { performanceMonitor } from './performance-monitor'

interface MemoryUsage {
  heapUsed: number
  heapTotal: number
  external: number
  arrayBuffers: number
  rss: number
}

interface ResourceStats {
  memoryUsage: MemoryUsage
  cacheSize: number
  vectorCount: number
  compressionRatio: number
  lastGC: Date | null
  gcCount: number
}

interface ResourceConfig {
  maxMemoryUsage: number // 最大内存使用量(MB)
  gcThreshold: number // GC 触发阈值(MB)
  monitorInterval: number // 监控间隔(ms)
  compressionThreshold: number // 压缩阈值(维度)
  maxCacheSize: number // 最大缓存大小(MB)
}

interface ResourceEvents {
  error: (event: { error: Error }) => void
  resource_status: (stats: ResourceStats) => void
  gc_complete: (data: { timestamp: Date; memoryReclaimed: number }) => void
  cache_optimized: (data: { newSize: number; itemsRemoved: number }) => void
  config_updated: (config: ResourceConfig) => void
}

// 修改 VectorCache 接口定义
interface VectorCacheExtended extends VectorCache {
  trim(targetSize: number): Promise<void>
  getQueueLength(cacheName: string): number
}

// 扩展 EventEmitter 类型
interface TypedEventEmitter<Events> {
  on<E extends keyof Events>(event: E, listener: Events[E]): this
  emit<E extends keyof Events>(event: E, ...args: Parameters<Events[E]>): boolean
}

// 资源管理器基类
class TypedResourceEmitter extends EventEmitter implements TypedEventEmitter<ResourceEvents> {
  on<E extends keyof ResourceEvents>(event: E, listener: ResourceEvents[E]): this {
    return super.on(event, listener)
  }

  emit<E extends keyof ResourceEvents>(event: E, ...args: Parameters<ResourceEvents[E]>): boolean {
    return super.emit(event, ...args)
  }
}

export class ResourceManager extends TypedResourceEmitter {
  private static instance: ResourceManager
  private config: ResourceConfig
  private vectorCache: VectorCacheExtended
  private vectorCompressor: VectorCompressor
  private monitorInterval: NodeJS.Timeout | null = null
  private stats: ResourceStats

  private readonly DEFAULT_CONFIG: ResourceConfig = {
    maxMemoryUsage: 1024, // 1GB
    gcThreshold: 768, // 75%
    monitorInterval: 60000, // 1分钟
    compressionThreshold: 1024,
    maxCacheSize: 512 // 512MB
  }

  private constructor() {
    super()
    this.config = { ...this.DEFAULT_CONFIG }
    this.vectorCache = VectorCache.getInstance() as VectorCacheExtended
    this.vectorCompressor = VectorCompressor.getInstance()
    this.stats = this.initializeStats()
    this.startMonitoring()
  }

  static getInstance(): ResourceManager {
    if (!ResourceManager.instance) {
      ResourceManager.instance = new ResourceManager()
    }
    return ResourceManager.instance
  }

  /**
   * 初始化统计信息
   */
  private initializeStats(): ResourceStats {
    return {
      memoryUsage: process.memoryUsage(),
      cacheSize: 0,
      vectorCount: 0,
      compressionRatio: 0,
      lastGC: null,
      gcCount: 0
    }
  }

  /**
   * 开始资源监控
   */
  private startMonitoring(): void {
    if (this.monitorInterval) return

    this.monitorInterval = setInterval(() => {
      this.checkResources()
    }, this.config.monitorInterval)

    // 添加性能监控
    performanceMonitor.startOperation('resource_monitoring')
  }

  /**
   * 检查资源使用情况
   */
  private async checkResources(): Promise<void> {
    const endMonitoring = performanceMonitor.startOperation('resource_check')
    try {
      // 更新统计信息
      this.updateStats()

      // 检查内存使用
      if (this.shouldTriggerGC()) {
        await this.garbageCollect()
      }

      // 检查缓存大小
      if (this.stats.cacheSize > this.config.maxCacheSize) {
        await this.optimizeCache()
      }

      // 检查向量压缩
      await this.checkVectorCompression()

      // 发出资源状态事件
      this.emit('resource_status', this.stats)
    } catch (error) {
      this.emit('error', { error: error instanceof Error ? error : new Error(String(error)) })
    } finally {
      endMonitoring()
    }
  }

  /**
   * 更新资源统计信息
   */
  private updateStats(): void {
    this.stats.memoryUsage = process.memoryUsage()
    this.stats.cacheSize = this.calculateCacheSize()
    this.stats.vectorCount = this.getVectorCount()
    this.stats.compressionRatio = this.calculateCompressionRatio()
  }

  /**
   * 判断是否需要触发 GC
   */
  private shouldTriggerGC(): boolean {
    const memoryUsageMB = this.stats.memoryUsage.heapUsed / (1024 * 1024)
    return memoryUsageMB > this.config.gcThreshold
  }

  /**
   * 执行垃圾回收
   */
  private async garbageCollect(): Promise<void> {
    const endGC = performanceMonitor.startOperation('garbage_collection')
    try {
      // 清理过期缓存
      await this.vectorCache.clear('expired')

      // 压缩大向量
      await this.compressLargeVectors()

      // 更新统计信息
      this.stats.lastGC = new Date()
      this.stats.gcCount++

      // 触发全局 GC
      if (global.gc) {
        global.gc()
      }

      this.emit('gc_complete', {
        timestamp: this.stats.lastGC,
        memoryReclaimed: this.calculateReclaimedMemory()
      })
    } catch (error) {
      this.emit('error', { error: error instanceof Error ? error : new Error(String(error)) })
    } finally {
      endGC()
    }
  }

  /**
   * 优化缓存使用
   */
  private async optimizeCache(): Promise<void> {
    const endOptimization = performanceMonitor.startOperation('cache_optimization')
    try {
      // 移除最少使用的缓存项
      const targetSize = this.config.maxCacheSize * 0.8 // 降至80%
      await this.vectorCache.trim(targetSize)

      // 压缩剩余缓存项
      await this.compressCacheEntries()

      const newStats = {
        newSize: this.calculateCacheSize(),
        itemsRemoved: this.stats.vectorCount - this.getVectorCount()
      }

      this.emit('cache_optimized', newStats)
    } catch (error) {
      this.emit('error', { error: error instanceof Error ? error : new Error(String(error)) })
    } finally {
      endOptimization()
    }
  }

  /**
   * 检查向量压缩
   */
  private async checkVectorCompression(): Promise<void> {
    const vectors = await this.getLargeUncompressedVectors()
    if (vectors.length > 0) {
      const endCompression = performanceMonitor.startOperation('vector_compression')
      try {
        for (const vector of vectors) {
          await this.vectorCompressor.compress([vector.data], {
            method: 'pq',
            params: {
              nsubvector: 8,
              nbits: 8
            }
          })
        }
      } catch (error) {
        this.emit('error', { error: error instanceof Error ? error : new Error(String(error)) })
      } finally {
        endCompression()
      }
    }
  }

  /**
   * 计算缓存大小
   */
  private calculateCacheSize(): number {
    const cacheStats = this.vectorCache.getAllMetrics()
    return Array.from(cacheStats.values()).reduce((total, stats) => total + stats.size, 0)
  }

  /**
   * 获取向量数量
   */
  private getVectorCount(): number {
    const cacheNames = this.vectorCache.getCacheNames()
    return cacheNames.reduce((total, name) => total + this.vectorCache.getQueueLength(name), 0)
  }

  /**
   * 计算压缩率
   */
  private calculateCompressionRatio(): number {
    const metrics = this.vectorCompressor.getAllMetrics()
    if (metrics.size === 0) return 0

    const ratios = Array.from(metrics.values()).map(m => m.compressionRatio)
    return ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length
  }

  /**
   * 计算回收的内存
   */
  private calculateReclaimedMemory(): number {
    const currentUsage = process.memoryUsage().heapUsed
    const previousUsage = this.stats.memoryUsage.heapUsed
    return Math.max(0, previousUsage - currentUsage)
  }

  /**
   * 获取大型未压缩向量
   */
  private async getLargeUncompressedVectors(): Promise<Array<{ id: string; data: number[] }>> {
    // 实现获取大型未压缩向量的逻辑
    return []
  }

  /**
   * 压缩大型向量
   */
  private async compressLargeVectors(): Promise<void> {
    const vectors = await this.getLargeUncompressedVectors()
    for (const vector of vectors) {
      if (vector.data.length > this.config.compressionThreshold) {
        await this.vectorCompressor.compress([vector.data])
      }
    }
  }

  /**
   * 压缩缓存条目
   */
  private async compressCacheEntries(): Promise<void> {
    // 实现缓存条目压缩逻辑
  }

  /**
   * 配置管理
   */
  setConfig(config: Partial<ResourceConfig>): void {
    this.config = { ...this.config, ...config }
    this.emit('config_updated', this.config)
  }

  /**
   * 获取当前配置
   */
  getConfig(): ResourceConfig {
    return { ...this.config }
  }

  /**
   * 获取资源统计信息
   */
  getStats(): ResourceStats {
    return { ...this.stats }
  }

  /**
   * 停止资源监控
   */
  stop(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval)
      this.monitorInterval = null
    }
  }
}

// 导出单例实例
export const resourceManager = ResourceManager.getInstance() 