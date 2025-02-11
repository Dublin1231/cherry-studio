import { DataType } from '@zilliz/milvus2-sdk-node'
import { EventEmitter } from 'events'

import { errorHandler } from './error-handler'
import { milvus } from './milvus'

// 更新操作状态
type UpdateStatus = 'pending' | 'processing' | 'completed' | 'failed'

// 更新操作
interface UpdateOperation {
  id: string
  vector: number[]
  metadata?: Record<string, unknown>
  status: UpdateStatus
  retryCount: number
  timestamp: Date
}

// 更新指标
interface UpdateMetrics {
  totalUpdates: number
  successfulUpdates: number
  failedUpdates: number
  averageLatency: number
  batchSize: number
  lastUpdate: Date | null
}

// 向量更新管理器类
class VectorUpdateManager extends EventEmitter {
  private static instance: VectorUpdateManager
  private updateQueues: Map<string, UpdateOperation[]>
  private metrics: Map<string, UpdateMetrics>
  private batchSize: number
  private updateInterval: number
  private maxRetries: number
  private updateLoopRunning: boolean

  private constructor() {
    super()
    this.updateQueues = new Map()
    this.metrics = new Map()
    this.batchSize = 10
    this.updateInterval = 1000
    this.maxRetries = 3
    this.updateLoopRunning = false
    this.startUpdateLoop()
  }

  // 获取单例实例
  static getInstance(): VectorUpdateManager {
    if (!VectorUpdateManager.instance) {
      VectorUpdateManager.instance = new VectorUpdateManager()
    }
    return VectorUpdateManager.instance
  }

  // 将更新操作加入队列
  async queueUpdate(
    collectionName: string,
    id: string,
    vector: number[],
    metadata?: Record<string, unknown>
  ): Promise<void> {
    // 初始化集合的队列和指标
    if (!this.updateQueues.has(collectionName)) {
      this.updateQueues.set(collectionName, [])
      this.metrics.set(collectionName, {
        totalUpdates: 0,
        successfulUpdates: 0,
        failedUpdates: 0,
        averageLatency: 0,
        batchSize: this.batchSize,
        lastUpdate: null
      })
    }

    // 创建更新操作
    const operation: UpdateOperation = {
      id,
      vector,
      metadata,
      status: 'pending',
      retryCount: 0,
      timestamp: new Date()
    }

    // 将操作加入队列
    const queue = this.updateQueues.get(collectionName)!
    queue.push(operation)

    // 发出事件
    this.emit('update_queued', {
      collectionName,
      operation
    })

    // 如果队列达到批处理大小，立即处理
    if (queue.length >= this.batchSize) {
      await this.processQueue(collectionName)
    }
  }

  // 处理更新队列
  private async processQueue(collectionName: string): Promise<void> {
    const queue = this.updateQueues.get(collectionName)
    if (!queue || queue.length === 0) return

    // 获取待处理的批次
    const batch = queue.slice(0, this.batchSize)
    const startTime = Date.now()

    try {
      // 更新状态
      batch.forEach(op => (op.status = 'processing'))

      // 准备更新数据
      const ids = batch.map(op => op.id)
      const vectors = batch.map(op => op.vector)

      // 执行更新
      await milvus.upsert({
        collection_name: collectionName,
        fields_data: batch.map(op => ({
          id: op.id,
          vector: op.vector,
          ...op.metadata
        }))
      })

      // 更新成功
      batch.forEach(op => (op.status = 'completed'))
      this.updateMetrics(collectionName, batch.length, true, Date.now() - startTime)

      // 从队列中移除已处理的操作
      this.updateQueues.set(
        collectionName,
        queue.slice(batch.length)
      )

      // 发出事件
      this.emit('update_completed', {
        collectionName,
        batch
      })
    } catch (error) {
      // 更新失败
      const shouldRetry = batch.some(op => op.retryCount < this.maxRetries)

      if (shouldRetry) {
        // 增加重试次数
        batch.forEach(op => {
          op.status = 'pending'
          op.retryCount++
        })

        // 发出事件
        this.emit('update_failed', {
          collectionName,
          error,
          willRetry: true
        })

        // 等待一段时间后重试
        setTimeout(() => this.processQueue(collectionName), this.updateInterval)
      } else {
        // 达到最大重试次数
        batch.forEach(op => (op.status = 'failed'))
        this.updateMetrics(collectionName, batch.length, false, Date.now() - startTime)

        // 从队列中移除失败的操作
        this.updateQueues.set(
          collectionName,
          queue.slice(batch.length)
        )

        // 发出事件
        this.emit('update_failed', {
          collectionName,
          error,
          willRetry: false
        })

        // 记录错误
        errorHandler.handleError(error as Error, {
          context: 'vector_update',
          collection: collectionName
        })
      }
    }
  }

  // 更新指标
  private updateMetrics(
    collectionName: string,
    count: number,
    success: boolean,
    latency: number
  ): void {
    const metrics = this.metrics.get(collectionName)!
    metrics.totalUpdates += count
    if (success) {
      metrics.successfulUpdates += count
    } else {
      metrics.failedUpdates += count
    }
    metrics.averageLatency =
      (metrics.averageLatency * (metrics.totalUpdates - count) + latency) /
      metrics.totalUpdates
    metrics.lastUpdate = new Date()
  }

  // 启动更新循环
  private startUpdateLoop(): void {
    if (this.updateLoopRunning) return

    this.updateLoopRunning = true
    const processAllQueues = async () => {
      if (!this.updateLoopRunning) return

      // 处理所有集合的队列
      for (const [collectionName] of this.updateQueues) {
        await this.processQueue(collectionName)
      }

      // 继续循环
      setTimeout(processAllQueues, this.updateInterval)
    }

    processAllQueues()
  }

  // 停止更新循环
  stopUpdateLoop(): void {
    this.updateLoopRunning = false
  }

  // 获取队列长度
  getQueueLength(collectionName: string): number {
    return this.updateQueues.get(collectionName)?.length || 0
  }

  // 获取指标
  getMetrics(collectionName: string): UpdateMetrics | undefined {
    return this.metrics.get(collectionName)
  }

  // 清理队列
  clearQueue(collectionName?: string): void {
    if (collectionName) {
      this.updateQueues.delete(collectionName)
      this.metrics.delete(collectionName)
    } else {
      this.updateQueues.clear()
      this.metrics.clear()
    }
  }

  // 设置批处理大小
  setBatchSize(size: number): void {
    if (size > 0) {
      this.batchSize = size
      for (const metrics of this.metrics.values()) {
        metrics.batchSize = size
      }
    }
  }

  // 设置更新间隔
  setUpdateInterval(interval: number): void {
    if (interval > 0) {
      this.updateInterval = interval
    }
  }

  // 设置最大重试次数
  setMaxRetries(retries: number): void {
    if (retries >= 0) {
      this.maxRetries = retries
    }
  }
}

// 导出单例实例
export const vectorUpdateManager = VectorUpdateManager.getInstance()
