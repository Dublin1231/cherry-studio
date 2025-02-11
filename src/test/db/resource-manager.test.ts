import { ResourceManager } from '../../main/db/resource-manager'
import { VectorCache } from '../../main/db/vector-cache'
import { VectorCompressor } from '../../main/db/vector-compressor'
import { performanceMonitor } from '../../main/db/performance-monitor'
import { jest, describe, beforeEach, it, expect, afterEach } from '@jest/globals'

// Mock 依赖
jest.mock('../../main/db/vector-cache', () => ({
  getInstance: jest.fn()
}))
jest.mock('../../main/db/vector-compressor', () => ({
  getInstance: jest.fn()
}))
jest.mock('../../main/db/performance-monitor')

interface MockCacheMetrics {
  hits: number
  misses: number
  size: number
  evictions: number
  usage: number
}

interface MockCompressionMetrics {
  compressionRatio: number
  originalSize: number
  compressedSize: number
  accuracy: number
  speed: number
}

interface ErrorEvent {
  error: Error
}

describe('ResourceManager', () => {
  let resourceManager: ResourceManager
  let mockVectorCache: jest.Mocked<VectorCache>
  let mockVectorCompressor: jest.Mocked<VectorCompressor>

  beforeEach(() => {
    jest.clearAllMocks()
    
    // 设置 mock 实现
    mockVectorCache = {
      getInstance: jest.fn().mockReturnThis(),
      getAllMetrics: jest.fn().mockReturnValue(new Map()),
      getCacheNames: jest.fn().mockReturnValue([]),
      clear: jest.fn(),
      trim: jest.fn(),
      getQueueLength: jest.fn()
    } as unknown as jest.Mocked<VectorCache>

    mockVectorCompressor = {
      getInstance: jest.fn().mockReturnThis(),
      getAllMetrics: jest.fn().mockReturnValue(new Map()),
      compress: jest.fn()
    } as unknown as jest.Mocked<VectorCompressor>

    // 设置静态方法
    ;(VectorCache.getInstance as jest.Mock).mockReturnValue(mockVectorCache)
    ;(VectorCompressor.getInstance as jest.Mock).mockReturnValue(mockVectorCompressor)
    ;(performanceMonitor.startOperation as jest.Mock).mockReturnValue(jest.fn())

    resourceManager = ResourceManager.getInstance()
  })

  describe('基本功能', () => {
    it('应该正确初始化资源管理器', () => {
      expect(resourceManager).toBeDefined()
      expect(resourceManager.getConfig()).toBeDefined()
      expect(resourceManager.getStats()).toBeDefined()
    })

    it('应该能够更新配置', () => {
      const newConfig = {
        maxMemoryUsage: 2048,
        gcThreshold: 1536
      }

      resourceManager.setConfig(newConfig)
      const config = resourceManager.getConfig()

      expect(config.maxMemoryUsage).toBe(2048)
      expect(config.gcThreshold).toBe(1536)
    })
  })

  describe('资源监控', () => {
    it('应该正确监控内存使用', () => {
      const stats = resourceManager.getStats()
      expect(stats.memoryUsage).toBeDefined()
      expect(stats.memoryUsage.heapUsed).toBeGreaterThan(0)
    })

    it('应该正确计算缓存大小', () => {
      const mockMetrics = new Map<string, MockCacheMetrics>([
        ['cache1', { hits: 0, misses: 0, size: 100, evictions: 0, usage: 0 }],
        ['cache2', { hits: 0, misses: 0, size: 200, evictions: 0, usage: 0 }]
      ])

      mockVectorCache.getAllMetrics.mockReturnValue(mockMetrics as Map<string, any>)

      const stats = resourceManager.getStats()
      expect(stats.cacheSize).toBe(300)
    })

    it('应该正确计算压缩率', () => {
      const mockMetrics = new Map<string, MockCompressionMetrics>([
        ['method1', {
          compressionRatio: 0.5,
          originalSize: 1000,
          compressedSize: 500,
          accuracy: 0.95,
          speed: 100
        }],
        ['method2', {
          compressionRatio: 0.7,
          originalSize: 1000,
          compressedSize: 700,
          accuracy: 0.98,
          speed: 120
        }]
      ])

      mockVectorCompressor.getAllMetrics.mockReturnValue(mockMetrics as Map<string, any>)

      const stats = resourceManager.getStats()
      expect(stats.compressionRatio).toBe(0.6)
    })
  })

  describe('垃圾回收', () => {
    it('应该在内存使用超过阈值时触发 GC', async () => {
      // 模拟高内存使用
      const mockMemoryUsage = {
        heapUsed: 900 * 1024 * 1024, // 900MB
        heapTotal: 1024 * 1024 * 1024,
        external: 0,
        arrayBuffers: 0,
        rss: 1200 * 1024 * 1024
      }
      jest.spyOn(process, 'memoryUsage').mockReturnValue(mockMemoryUsage)

      // 触发资源检查
      await resourceManager['checkResources']()

      expect(mockVectorCache.clear).toHaveBeenCalledWith('expired')
      expect(mockVectorCompressor.compress).toHaveBeenCalled()
    })

    it('应该正确计算回收的内存', async () => {
      // 模拟 GC 前后的内存使用
      const beforeGC = {
        heapUsed: 900 * 1024 * 1024,
        heapTotal: 1024 * 1024 * 1024,
        external: 0,
        arrayBuffers: 0,
        rss: 1200 * 1024 * 1024
      }
      const afterGC = {
        heapUsed: 700 * 1024 * 1024,
        heapTotal: 1024 * 1024 * 1024,
        external: 0,
        arrayBuffers: 0,
        rss: 1000 * 1024 * 1024
      }

      jest.spyOn(process, 'memoryUsage')
        .mockReturnValueOnce(beforeGC)
        .mockReturnValueOnce(afterGC)

      await resourceManager['garbageCollect']()

      const reclaimedMemory = resourceManager['calculateReclaimedMemory']()
      expect(reclaimedMemory).toBe(200 * 1024 * 1024) // 200MB
    })
  })

  describe('缓存优化', () => {
    it('应该在缓存大小超过阈值时进行优化', async () => {
      // 模拟大缓存
      const mockMetrics = new Map<string, MockCacheMetrics>([
        ['cache1', { hits: 0, misses: 0, size: 600, evictions: 0, usage: 60 }],
        ['cache2', { hits: 0, misses: 0, size: 500, evictions: 0, usage: 50 }]
      ])

      mockVectorCache.getAllMetrics.mockReturnValue(mockMetrics as Map<string, any>)

      await resourceManager['optimizeCache']()

      expect(mockVectorCache.trim).toHaveBeenCalled()
      expect(mockVectorCompressor.compress).toHaveBeenCalled()
    })

    it('应该正确处理压缩大向量', async () => {
      const largeVector = new Array(2048).fill(0.1)
      await resourceManager['compressLargeVectors']()

      expect(mockVectorCompressor.compress).toHaveBeenCalledWith(
        expect.arrayContaining([expect.any(Array)]),
        expect.any(Object)
      )
    })
  })

  describe('事件发送', () => {
    it('应该在资源状态更新时发出事件', (done) => {
      resourceManager.on('resource_status', (stats) => {
        expect(stats).toBeDefined()
        expect(stats.memoryUsage).toBeDefined()
        done()
      })

      resourceManager['checkResources']()
    })

    it('应该在 GC 完成时发出事件', (done) => {
      resourceManager.on('gc_complete', (data) => {
        expect(data.timestamp).toBeDefined()
        expect(data.memoryReclaimed).toBeGreaterThanOrEqual(0)
        done()
      })

      resourceManager['garbageCollect']()
    })

    it('应该在缓存优化完成时发出事件', (done) => {
      resourceManager.on('cache_optimized', (data) => {
        expect(data.newSize).toBeDefined()
        expect(data.itemsRemoved).toBeGreaterThanOrEqual(0)
        done()
      })

      resourceManager['optimizeCache']()
    })
  })

  describe('错误处理', () => {
    it('应该处理资源检查过程中的错误', (done) => {
      mockVectorCache.getAllMetrics.mockImplementation(() => {
        throw new Error('测试错误')
      })

      resourceManager.on('error', (event: ErrorEvent) => {
        expect(event).toBeDefined()
        expect(event.error.message).toBe('测试错误')
        done()
      })

      resourceManager['checkResources']()
    })

    it('应该处理垃圾回收过程中的错误', (done) => {
      mockVectorCache.clear.mockRejectedValue(new Error('GC 错误'))

      resourceManager.on('error', (event: ErrorEvent) => {
        expect(event).toBeDefined()
        expect(event.error.message).toBe('GC 错误')
        done()
      })

      resourceManager['garbageCollect']()
    })
  })

  afterEach(() => {
    resourceManager.stop()
  })
}) 