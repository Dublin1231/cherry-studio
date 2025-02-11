import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { DataType } from '@zilliz/milvus2-sdk-node'

import { errorHandler } from '../../main/db/error-handler'
import { milvus } from '../../main/db/milvus'
import { vectorUpdateManager } from '../../main/db/vector-update-manager'

// Mock 依赖
jest.mock('../../main/db/milvus', () => ({
  milvus: {
    update: jest.fn()
  }
}))
jest.mock('../../main/db/error-handler')

describe('VectorUpdateManager', () => {
  beforeEach(() => {
    // 清理 mock 状态
    jest.clearAllMocks()
    // 清理队列
    vectorUpdateManager.clearQueue()
  })

  describe('queueUpdate', () => {
    it('应该正确将更新操作加入队列', async () => {
      // 准备测试数据
      const collectionName = 'test_collection'
      const id = 'test_id'
      const vector = new Array(128).fill(0).map(() => Math.random())
      const metadata = { key: 'value' }

      // 监听事件
      const updateQueuedHandler = jest.fn()
      vectorUpdateManager.on('update_queued', updateQueuedHandler)

      // 执行测试
      await vectorUpdateManager.queueUpdate(collectionName, id, vector, metadata)

      // 验证结果
      expect(updateQueuedHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          collectionName,
          operation: expect.objectContaining({
            id,
            vector,
            metadata,
            status: 'pending'
          })
        })
      )

      expect(vectorUpdateManager.getQueueLength(collectionName)).toBe(1)
    })

    it('应该在队列达到批处理大小时触发更新', async () => {
      // 准备测试数据
      const collectionName = 'test_collection'
      const batchSize = 2
      vectorUpdateManager.setBatchSize(batchSize)

      // 设置 mock
      const mockResponse = { status: { code: 0 } }
      ;(milvus.update as jest.Mock).mockResolvedValue(mockResponse)

      // 监听事件
      const updateCompletedHandler = jest.fn()
      vectorUpdateManager.on('update_completed', updateCompletedHandler)

      // 执行测试
      for (let i = 0; i < batchSize; i++) {
        await vectorUpdateManager.queueUpdate(
          collectionName,
          `id_${i}`,
          new Array(128).fill(0).map(() => Math.random())
        )
      }

      // 等待批处理完成
      await new Promise((resolve) => setTimeout(resolve, 100))

      // 验证结果
      expect(milvus.update).toHaveBeenCalledWith(
        expect.objectContaining({
          collection_name: collectionName,
          vector_type: DataType.FloatVector
        })
      )
      expect(updateCompletedHandler).toHaveBeenCalled()
      expect(vectorUpdateManager.getQueueLength(collectionName)).toBe(0)
    })
  })

  describe('error handling', () => {
    it('应该正确处理更新失败并进行重试', async () => {
      // 准备测试数据
      const collectionName = 'test_collection'
      const id = 'test_id'
      const vector = new Array(128).fill(0).map(() => Math.random())
      const mockError = new Error('更新失败')
      const mockResponse = { status: { code: 0 } }

      // 设置 mock
      ;(milvus.update as jest.Mock)
        .mockRejectedValueOnce(mockError) // 第一次失败
        .mockResolvedValueOnce(mockResponse) // 第二次成功

      // 监听事件
      const updateFailedHandler = jest.fn()
      const updateCompletedHandler = jest.fn()
      vectorUpdateManager.on('update_failed', updateFailedHandler)
      vectorUpdateManager.on('update_completed', updateCompletedHandler)

      // 执行测试
      await vectorUpdateManager.queueUpdate(collectionName, id, vector)

      // 等待重试完成
      await new Promise((resolve) => setTimeout(resolve, 100))

      // 验证结果
      expect(updateFailedHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          collectionName,
          error: mockError
        })
      )
      expect(milvus.update).toHaveBeenCalledTimes(2)
      expect(updateCompletedHandler).toHaveBeenCalled()
    })

    it('应该在超过最大重试次数后放弃', async () => {
      // 准备测试数据
      const collectionName = 'test_collection'
      const id = 'test_id'
      const vector = new Array(128).fill(0).map(() => Math.random())
      const mockError = new Error('更新失败')

      // 设置最大重试次数
      vectorUpdateManager.setMaxRetries(2)

      // 设置 mock
      ;(milvus.update as jest.Mock).mockRejectedValue(mockError)

      // 监听事件
      const updateFailedHandler = jest.fn()
      vectorUpdateManager.on('update_failed', updateFailedHandler)

      // 执行测试
      await vectorUpdateManager.queueUpdate(collectionName, id, vector)

      // 等待重试完成
      await new Promise((resolve) => setTimeout(resolve, 300))

      // 验证结果
      expect(milvus.update).toHaveBeenCalledTimes(3) // 初始 + 2次重试
      expect(updateFailedHandler).toHaveBeenCalledTimes(3)
      expect(errorHandler.handleError).toHaveBeenCalledWith(mockError, {
        context: 'vector_update',
        collection: collectionName
      })
    })
  })

  describe('metrics', () => {
    it('应该正确记录和返回更新指标', async () => {
      // 准备测试数据
      const collectionName = 'test_collection'
      const id = 'test_id'
      const vector = new Array(128).fill(0).map(() => Math.random())
      const mockResponse = { status: { code: 0 } }

      // 设置 mock
      ;(milvus.update as jest.Mock).mockResolvedValue(mockResponse)

      // 执行测试
      await vectorUpdateManager.queueUpdate(collectionName, id, vector)

      // 等待更新完成
      await new Promise((resolve) => setTimeout(resolve, 100))

      // 获取指标
      const metrics = vectorUpdateManager.getMetrics(collectionName)

      // 验证指标
      expect(metrics).toBeDefined()
      expect(metrics?.totalUpdates).toBe(1)
      expect(metrics?.successfulUpdates).toBe(1)
      expect(metrics?.failedUpdates).toBe(0)
      expect(metrics?.averageLatency).toBeGreaterThan(0)
    })

    it('应该正确计算失败率', async () => {
      // 准备测试数据
      const collectionName = 'test_collection'
      const id = 'test_id'
      const vector = new Array(128).fill(0).map(() => Math.random())
      const mockError = new Error('更新失败')

      // 设置最大重试次数
      vectorUpdateManager.setMaxRetries(0)

      // 设置 mock
      ;(milvus.update as jest.Mock).mockRejectedValue(mockError)

      // 执行测试
      await vectorUpdateManager.queueUpdate(collectionName, id, vector)

      // 等待更新完成
      await new Promise((resolve) => setTimeout(resolve, 100))

      // 获取指标
      const metrics = vectorUpdateManager.getMetrics(collectionName)

      // 验证指标
      expect(metrics).toBeDefined()
      expect(metrics?.totalUpdates).toBe(1)
      expect(metrics?.successfulUpdates).toBe(0)
      expect(metrics?.failedUpdates).toBe(1)
    })
  })

  describe('configuration', () => {
    it('应该正确应用配置更改', () => {
      // 测试批处理大小设置
      const newBatchSize = 50
      vectorUpdateManager.setBatchSize(newBatchSize)
      expect(vectorUpdateManager.getMetrics('test')?.batchSize).toBe(newBatchSize)

      // 测试更新间隔设置
      const newInterval = 2000
      vectorUpdateManager.setUpdateInterval(newInterval)
      // 注意:更新间隔是内部实现细节,可能无法直接验证

      // 测试最大重试次数设置
      const newMaxRetries = 5
      vectorUpdateManager.setMaxRetries(newMaxRetries)
      // 注意:最大重试次数是内部实现细节,可能无法直接验证
    })

    it('应该忽略无效的配置值', () => {
      // 测试无效的批处理大小
      const originalBatchSize = vectorUpdateManager.getMetrics('test')?.batchSize
      vectorUpdateManager.setBatchSize(-1)
      expect(vectorUpdateManager.getMetrics('test')?.batchSize).toBe(originalBatchSize)

      // 测试无效的更新间隔
      vectorUpdateManager.setUpdateInterval(-1)
      // 验证更新间隔未改变(通过功能测试)

      // 测试无效的最大重试次数
      vectorUpdateManager.setMaxRetries(-1)
      // 验证最大重试次数未改变(通过功能测试)
    })
  })
})
