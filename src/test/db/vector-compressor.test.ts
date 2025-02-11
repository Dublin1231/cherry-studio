import { VectorCompressor } from '../../main/db/vector-compressor'

describe('VectorCompressor', () => {
  let compressor: VectorCompressor

  beforeEach(() => {
    jest.clearAllMocks()
    compressor = VectorCompressor.getInstance()
  })

  describe('compress', () => {
    const testVectors = [
      new Array(128).fill(0.1),
      new Array(128).fill(0.2)
    ]

    it('应该使用默认方法成功压缩向量', async () => {
      const result = await compressor.compress(testVectors)

      expect(result.compressed).toBeDefined()
      expect(result.metrics).toHaveProperty('compressionRatio')
      expect(result.metrics.compressionRatio).toBeGreaterThan(0)
    })

    it('应该使用指定的压缩方法', async () => {
      const result = await compressor.compress(testVectors, {
        method: 'pq',
        params: {
          nsubvector: 8,
          nbits: 8
        }
      })

      expect(result.compressed).toBeDefined()
      expect(result.metrics.compressionRatio).toBeGreaterThan(0)
    })

    it('应该根据向量维度自动选择最佳压缩方法', async () => {
      const highDimVectors = [
        new Array(1024).fill(0.1),
        new Array(1024).fill(0.2)
      ]

      const result = await compressor.compress(highDimVectors)

      expect(result.metrics.compressionRatio).toBeGreaterThan(0)
      // 高维向量应该使用 PQ 或 IVF-PQ 方法
      expect(['pq', 'ivfpq']).toContain(result.metrics.method)
    })
  })

  describe('指标管理', () => {
    it('应该正确记录和获取压缩指标', async () => {
      const testVectors = [new Array(128).fill(0.1)]
      await compressor.compress(testVectors)

      const metrics = compressor.getMetrics('pq')
      expect(metrics).toBeDefined()
      expect(metrics).toHaveProperty('compressionRatio')
      expect(metrics).toHaveProperty('accuracy')
    })

    it('应该能够获取所有压缩方法的指标', () => {
      const allMetrics = compressor.getAllMetrics()
      expect(allMetrics).toBeDefined()
      expect(allMetrics instanceof Map).toBeTruthy()
    })
  })

  describe('压缩方法管理', () => {
    it('应该能够获取所有支持的压缩方法', () => {
      const methods = compressor.getSupportedMethods()
      expect(methods).toContain('pq')
      expect(methods).toContain('sq')
      expect(methods).toContain('ivfpq')
    })

    it('应该能够获取指定压缩方法的配置', () => {
      const config = compressor.getMethodConfig('pq')
      expect(config).toBeDefined()
      expect(config).toHaveProperty('params')
      expect(config).toHaveProperty('threshold')
    })
  })

  describe('错误处理', () => {
    it('应该处理无效的向量输入', async () => {
      const emptyVectors: number[][] = []
      await expect(compressor.compress(emptyVectors)).rejects.toThrow()
    })

    it('应该处理无效的压缩方法', async () => {
      const testVectors = [new Array(128).fill(0.1)]
      await expect(
        compressor.compress(testVectors, {
          method: 'invalid' as any
        })
      ).rejects.toThrow()
    })

    it('应该处理无效的参数配置', async () => {
      const testVectors = [new Array(128).fill(0.1)]
      await expect(
        compressor.compress(testVectors, {
          method: 'pq',
          params: {
            nsubvector: -1 // 无效的子向量数量
          }
        })
      ).rejects.toThrow()
    })
  })
}) 