import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { DataType } from '@zilliz/milvus2-sdk-node'
import { MilvusClient } from '@zilliz/milvus2-sdk-node'

import { milvus } from '../../main/db/milvus'
import { performanceMonitor } from '../../main/db/performance-monitor'
import { vectorSearchStrategy } from '../../main/db/vector-search-strategy'
import { VectorSearchStrategy } from '../../main/db/vector-search-strategy'

// Mock 依赖
jest.mock('../../main/db/milvus')
jest.mock('../../main/db/performance-monitor')

// Mock Milvus 客户端
jest.mock('../../main/db/milvus', () => ({
  milvus: {
    search: jest.fn(),
    getCollectionStatistics: jest.fn()
  }
}))

describe('VectorSearchStrategy', () => {
  let strategy: VectorSearchStrategy

  beforeEach(() => {
    jest.clearAllMocks()
    strategy = VectorSearchStrategy.getInstance()
  })

  describe('search', () => {
    const testVector = new Array(128).fill(0.1)

    it('应该使用默认策略成功执行搜索', async () => {
      // 模拟集合统计信息
      ;(milvus.getCollectionStatistics as jest.Mock).mockResolvedValue({
        row_count: 10000,
        data_size: 1024 * 1024
      })

      // 模拟搜索结果
      ;(milvus.search as jest.Mock).mockResolvedValue({
        results: [
          { id: '1', distance: 0.1, score: 0.9 },
          { id: '2', distance: 0.2, score: 0.8 }
        ]
      })

      const results = await strategy.search('test_collection', testVector)

      expect(results).toHaveLength(2)
      expect(results[0]).toHaveProperty('id', '1')
      expect(results[0]).toHaveProperty('score', 0.9)
      expect(milvus.search).toHaveBeenCalled()
    })

    it('应该使用指定的策略执行搜索', async () => {
      ;(milvus.getCollectionStatistics as jest.Mock).mockResolvedValue({
        row_count: 10000,
        data_size: 1024 * 1024
      })

      ;(milvus.search as jest.Mock).mockResolvedValue({
        results: [{ id: '1', distance: 0.1, score: 0.9 }]
      })

      const results = await strategy.search('test_collection', testVector, {
        strategy: 'HNSW',
        topK: 1,
        params: {
          ef: 100
        }
      })

      expect(results).toHaveLength(1)
      expect(milvus.search).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({ ef: 100 })
        })
      )
    })

    it('应该根据集合大小自动选择最佳策略', async () => {
      // 模拟大型集合
      ;(milvus.getCollectionStatistics as jest.Mock).mockResolvedValue({
        row_count: 1000000,
        data_size: 1024 * 1024 * 1024
      })

      await strategy.search('test_collection', testVector)

      // 验证是否使用了 IVF_SQ8 策略（适用于大型集合）
      expect(milvus.search).toHaveBeenCalledWith(
        expect.objectContaining({
          index_type: 'IVF_SQ8'
        })
      )
    })

    it('应该正确处理搜索错误', async () => {
      ;(milvus.search as jest.Mock).mockRejectedValue(new Error('搜索失败'))

      await expect(strategy.search('test_collection', testVector)).rejects.toThrow('搜索失败')
    })
  })

  describe('指标管理', () => {
    it('应该正确记录和获取搜索指标', async () => {
      ;(milvus.search as jest.Mock).mockResolvedValue({
        results: [{ id: '1', distance: 0.1, score: 0.9 }]
      })

      await strategy.search('test_collection', new Array(128).fill(0.1))

      const metrics = strategy.getMetrics('test_collection')
      expect(metrics).toBeDefined()
      expect(metrics).toHaveProperty('latency')
      expect(metrics).toHaveProperty('accuracy')
    })

    it('应该能够清除指标', () => {
      strategy.clearMetrics('test_collection')
      expect(strategy.getMetrics('test_collection')).toBeUndefined()
    })
  })

  describe('策略选择', () => {
    it('应该为小型集合选择 HNSW 策略', async () => {
      ;(milvus.getCollectionStatistics as jest.Mock).mockResolvedValue({
        row_count: 1000,
        data_size: 1024 * 1024
      })

      await strategy.search('test_collection', new Array(128).fill(0.1))

      expect(milvus.search).toHaveBeenCalledWith(
        expect.objectContaining({
          index_type: 'HNSW'
        })
      )
    })

    it('应该为高 QPS 场景选择 IVF_FLAT 策略', async () => {
      ;(milvus.getCollectionStatistics as jest.Mock).mockResolvedValue({
        row_count: 50000,
        data_size: 1024 * 1024 * 100
      })

      // 模拟高 QPS 场景
      for (let i = 0; i < 10; i++) {
        await strategy.search('test_collection', new Array(128).fill(0.1))
      }

      expect(milvus.search).toHaveBeenLastCalledWith(
        expect.objectContaining({
          index_type: 'IVF_FLAT'
        })
      )
    })
  })
})
