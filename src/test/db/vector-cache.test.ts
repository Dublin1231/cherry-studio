import { VectorCache } from '../../main/db/vector-cache'

describe('VectorCache', () => {
  let cache: VectorCache

  beforeEach(() => {
    jest.clearAllMocks()
    cache = VectorCache.getInstance()
    // 清理所有缓存
    cache.clear('test_cache')
  })

  describe('缓存管理', () => {
    it('应该成功创建新的缓存', () => {
      cache.createCache('test_cache', {
        maxSize: 100,
        maxAge: 1000,
        updateAgeOnGet: true
      })

      expect(cache.getCacheNames()).toContain('test_cache')
    })

    it('应该获取缓存配置', () => {
      cache.createCache('test_cache', {
        maxSize: 100,
        maxAge: 1000
      })

      const config = cache.getCacheConfig('test_cache')
      expect(config).toBeDefined()
      expect(config?.maxSize).toBe(100)
      expect(config?.maxAge).toBe(1000)
    })
  })

  describe('向量操作', () => {
    const testVector = new Array(128).fill(0.1)
    const testMetadata = { type: 'test' }

    beforeEach(() => {
      cache.createCache('test_cache', {
        maxSize: 100,
        maxAge: 1000
      })
    })

    it('应该成功存储和检索向量', async () => {
      await cache.set('test_cache', 'key1', testVector, testMetadata)
      const result = cache.get('test_cache', 'key1')

      expect(result).toBeDefined()
      expect(result?.vector).toEqual(testVector)
      expect(result?.metadata).toEqual(testMetadata)
    })

    it('应该只返回向量数据', async () => {
      await cache.set('test_cache', 'key1', testVector, testMetadata)
      const vector = await cache.getVector('test_cache', 'key1')

      expect(vector).toEqual(testVector)
    })

    it('应该成功删除缓存项', async () => {
      await cache.set('test_cache', 'key1', testVector)
      expect(cache.delete('test_cache', 'key1')).toBeTruthy()
      expect(cache.get('test_cache', 'key1')).toBeUndefined()
    })
  })

  describe('压缩功能', () => {
    const largeVector = new Array(2048).fill(0.1)

    beforeEach(() => {
      cache.createCache('test_cache', {
        maxSize: 100,
        maxAge: 1000
      })
    })

    it('应该对大向量进行压缩', async () => {
      cache.setCompressionEnabled(true)
      cache.setCompressionThreshold(1024)

      await cache.set('test_cache', 'key1', largeVector)
      const entry = cache.get('test_cache', 'key1')

      expect(entry?.compressed).toBeDefined()
      expect(entry?.vector).toBeUndefined()
    })

    it('应该正确解压缩向量', async () => {
      cache.setCompressionEnabled(true)
      cache.setCompressionThreshold(1024)

      await cache.set('test_cache', 'key1', largeVector)
      const vector = await cache.getVector('test_cache', 'key1')

      expect(vector).toEqual(largeVector)
    })
  })

  describe('指标监控', () => {
    beforeEach(() => {
      cache.createCache('test_cache', {
        maxSize: 100,
        maxAge: 1000
      })
    })

    it('应该正确记录缓存指标', async () => {
      const testVector = new Array(128).fill(0.1)

      await cache.set('test_cache', 'key1', testVector)
      cache.get('test_cache', 'key1')
      cache.get('test_cache', 'non_existent_key')

      const metrics = cache.getMetrics('test_cache')
      expect(metrics).toBeDefined()
      expect(metrics?.hits).toBe(1)
      expect(metrics?.misses).toBe(1)
    })

    it('应该能够获取所有缓存的指标', async () => {
      const allMetrics = cache.getAllMetrics()
      expect(allMetrics).toBeDefined()
      expect(allMetrics instanceof Map).toBeTruthy()
    })
  })

  describe('过期处理', () => {
    it('应该正确处理过期的缓存项', async () => {
      cache.createCache('test_cache', {
        maxSize: 100,
        maxAge: 100 // 100ms
      })

      const testVector = new Array(128).fill(0.1)
      await cache.set('test_cache', 'key1', testVector)

      // 等待缓存过期
      await new Promise(resolve => setTimeout(resolve, 200))

      expect(cache.get('test_cache', 'key1')).toBeUndefined()
    })

    it('应该在获取时更新访问时间', async () => {
      cache.createCache('test_cache', {
        maxSize: 100,
        maxAge: 200,
        updateAgeOnGet: true
      })

      const testVector = new Array(128).fill(0.1)
      await cache.set('test_cache', 'key1', testVector)

      // 等待一半的过期时间
      await new Promise(resolve => setTimeout(resolve, 100))

      // 访问缓存项，应该更新其过期时间
      cache.get('test_cache', 'key1')

      // 再等待一半的过期时间
      await new Promise(resolve => setTimeout(resolve, 100))

      // 缓存项应该仍然有效
      expect(cache.get('test_cache', 'key1')).toBeDefined()
    })
  })
}) 