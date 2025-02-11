import { PrismaClient } from '@prisma/client'

import { errorHandler } from './error-handler'
import { performanceMonitor } from './performance-monitor'
import { prisma } from './prisma'

interface BatchOperationConfig {
  batchSize: number
  retryAttempts: number
  retryDelay: number
  timeout: number
  parallel: boolean
}

interface BatchOperationStats {
  totalOperations: number
  successfulOperations: number
  failedOperations: number
  startTime: number
  endTime?: number
  averageLatency: number
}

interface BatchProgressCallback {
  (progress: { completed: number; total: number; success: number; failed: number; remainingTime: number }): void
}

export class BatchOperationManager {
  private static instance: BatchOperationManager

  private defaultConfig: BatchOperationConfig = {
    batchSize: 1000,
    retryAttempts: 3,
    retryDelay: 1000,
    timeout: 30000,
    parallel: true
  }

  private constructor() {
    // 私有构造函数，确保单例模式
  }

  public static getInstance(): BatchOperationManager {
    if (!BatchOperationManager.instance) {
      BatchOperationManager.instance = new BatchOperationManager()
    }
    return BatchOperationManager.instance
  }

  async bulkInsert<T extends Record<string, any>>(
    modelName: string,
    data: T[],
    config?: Partial<BatchOperationConfig>,
    progressCallback?: BatchProgressCallback
  ): Promise<BatchOperationStats> {
    const monitor = performanceMonitor.startOperation('bulkInsert')
    const finalConfig = { ...this.defaultConfig, ...config }
    const stats: BatchOperationStats = {
      totalOperations: data.length,
      successfulOperations: 0,
      failedOperations: 0,
      startTime: Date.now(),
      averageLatency: 0
    }

    try {
      const batches = this.splitIntoBatches(data, finalConfig.batchSize)
      const totalBatches = batches.length

      if (finalConfig.parallel) {
        await Promise.all(
          batches.map(async (batch, index) => {
            const result = await this.processBatch(modelName, batch, 'create', finalConfig)
            this.updateStats(stats, result)
            if (progressCallback) {
              this.reportProgress(stats, index + 1, totalBatches, progressCallback)
            }
          })
        )
      } else {
        for (let i = 0; i < totalBatches; i++) {
          const result = await this.processBatch(modelName, batches[i], 'create', finalConfig)
          this.updateStats(stats, result)
          if (progressCallback) {
            this.reportProgress(stats, i + 1, totalBatches, progressCallback)
          }
        }
      }

      return this.finalizeStats(stats)
    } catch (error) {
      errorHandler.handleError(error instanceof Error ? error : new Error(String(error)), {
        context: 'BatchOperationManager.bulkInsert',
        modelName,
        config: finalConfig
      })
      throw error
    } finally {
      monitor()
    }
  }

  async bulkUpdate<T extends Record<string, any>>(
    modelName: string,
    data: Array<{ where: any; data: T }>,
    config?: Partial<BatchOperationConfig>,
    progressCallback?: BatchProgressCallback
  ): Promise<BatchOperationStats> {
    const monitor = performanceMonitor.startOperation('bulkUpdate')
    const finalConfig = { ...this.defaultConfig, ...config }
    const stats: BatchOperationStats = {
      totalOperations: data.length,
      successfulOperations: 0,
      failedOperations: 0,
      startTime: Date.now(),
      averageLatency: 0
    }

    try {
      const batches = this.splitIntoBatches(data, finalConfig.batchSize)
      const totalBatches = batches.length

      if (finalConfig.parallel) {
        await Promise.all(
          batches.map(async (batch, index) => {
            const result = await this.processBatch(modelName, batch, 'update', finalConfig)
            this.updateStats(stats, result)
            if (progressCallback) {
              this.reportProgress(stats, index + 1, totalBatches, progressCallback)
            }
          })
        )
      } else {
        for (let i = 0; i < totalBatches; i++) {
          const result = await this.processBatch(modelName, batches[i], 'update', finalConfig)
          this.updateStats(stats, result)
          if (progressCallback) {
            this.reportProgress(stats, i + 1, totalBatches, progressCallback)
          }
        }
      }

      return this.finalizeStats(stats)
    } catch (error) {
      errorHandler.handleError(error instanceof Error ? error : new Error(String(error)), {
        context: 'BatchOperationManager.bulkUpdate',
        modelName,
        config: finalConfig
      })
      throw error
    } finally {
      monitor()
    }
  }

  async bulkDelete(
    modelName: string,
    where: any,
    config?: Partial<BatchOperationConfig>,
    progressCallback?: BatchProgressCallback
  ): Promise<BatchOperationStats> {
    const monitor = performanceMonitor.startOperation('bulkDelete')
    const finalConfig = { ...this.defaultConfig, ...config }
    const stats: BatchOperationStats = {
      totalOperations: 0,
      successfulOperations: 0,
      failedOperations: 0,
      startTime: Date.now(),
      averageLatency: 0
    }

    try {
      // 首先获取要删除的记录总数
      const count = await (prisma[modelName as keyof PrismaClient] as any).count({ where })
      stats.totalOperations = count

      if (count === 0) {
        return this.finalizeStats(stats)
      }

      // 分批删除
      let deleted = 0
      while (deleted < count) {
        const batch = await (prisma[modelName as keyof PrismaClient] as any).findMany({
          where,
          take: finalConfig.batchSize,
          select: { id: true }
        })

        if (batch.length === 0) break

        const result = await this.processBatch(
          modelName,
          batch.map((item) => item.id),
          'delete',
          finalConfig
        )

        this.updateStats(stats, result)
        deleted += batch.length

        if (progressCallback) {
          this.reportProgress(stats, deleted, count, progressCallback)
        }
      }

      return this.finalizeStats(stats)
    } catch (error) {
      errorHandler.handleError(error instanceof Error ? error : new Error(String(error)), {
        context: 'BatchOperationManager.bulkDelete',
        modelName,
        where,
        config: finalConfig
      })
      throw error
    } finally {
      monitor()
    }
  }

  async bulkImport(
    modelName: string,
    dataStream: AsyncIterable<any>,
    config?: Partial<BatchOperationConfig>,
    progressCallback?: BatchProgressCallback
  ): Promise<BatchOperationStats> {
    const monitor = performanceMonitor.startOperation('bulkImport')
    const finalConfig = { ...this.defaultConfig, ...config }
    const stats: BatchOperationStats = {
      totalOperations: 0,
      successfulOperations: 0,
      failedOperations: 0,
      startTime: Date.now(),
      averageLatency: 0
    }

    try {
      let batch: any[] = []
      let totalProcessed = 0

      for await (const item of dataStream) {
        batch.push(item)
        stats.totalOperations++

        if (batch.length >= finalConfig.batchSize) {
          const result = await this.processBatch(modelName, batch, 'create', finalConfig)
          this.updateStats(stats, result)
          totalProcessed += batch.length

          if (progressCallback) {
            this.reportProgress(stats, totalProcessed, stats.totalOperations, progressCallback)
          }

          batch = []
        }
      }

      // 处理剩余的数据
      if (batch.length > 0) {
        const result = await this.processBatch(modelName, batch, 'create', finalConfig)
        this.updateStats(stats, result)
        totalProcessed += batch.length

        if (progressCallback) {
          this.reportProgress(stats, totalProcessed, stats.totalOperations, progressCallback)
        }
      }

      return this.finalizeStats(stats)
    } catch (error) {
      errorHandler.handleError(error instanceof Error ? error : new Error(String(error)), {
        context: 'BatchOperationManager.bulkImport',
        modelName,
        config: finalConfig
      })
      throw error
    } finally {
      monitor()
    }
  }

  private splitIntoBatches<T>(data: T[], batchSize: number): T[][] {
    const batches: T[][] = []
    for (let i = 0; i < data.length; i += batchSize) {
      batches.push(data.slice(i, i + batchSize))
    }
    return batches
  }

  private async processBatch(
    modelName: string,
    batch: any[],
    operation: 'create' | 'update' | 'delete',
    config: BatchOperationConfig
  ): Promise<{ success: number; failed: number; latency: number }> {
    let attempts = 0
    let success = 0
    let failed = 0
    const startTime = Date.now()

    while (attempts < config.retryAttempts) {
      try {
        const prismaModel = prisma[modelName as keyof PrismaClient] as any

        switch (operation) {
          case 'create':
            await prismaModel.createMany({ data: batch })
            success = batch.length
            break

          case 'update':
            await Promise.all(
              batch.map((item) =>
                prismaModel.update({
                  where: item.where,
                  data: item.data
                })
              )
            )
            success = batch.length
            break

          case 'delete':
            await prismaModel.deleteMany({
              where: { id: { in: batch } }
            })
            success = batch.length
            break
        }

        break // 操作成功，退出重试循环
      } catch (error) {
        attempts++
        if (attempts === config.retryAttempts) {
          failed = batch.length
          errorHandler.handleError(error instanceof Error ? error : new Error(String(error)), {
            context: `BatchOperationManager.processBatch.${operation}`,
            modelName,
            batchSize: batch.length,
            attempt: attempts
          })
        } else {
          await new Promise((resolve) => setTimeout(resolve, config.retryDelay))
        }
      }
    }

    return {
      success,
      failed,
      latency: Date.now() - startTime
    }
  }

  private updateStats(stats: BatchOperationStats, result: { success: number; failed: number; latency: number }) {
    stats.successfulOperations += result.success
    stats.failedOperations += result.failed
    stats.averageLatency =
      (stats.averageLatency * (stats.successfulOperations - result.success) + result.latency * result.success) /
      stats.successfulOperations
  }

  private reportProgress(
    stats: BatchOperationStats,
    completed: number,
    total: number,
    callback: BatchProgressCallback
  ) {
    const elapsedTime = Date.now() - stats.startTime
    const operationsPerMs = completed / elapsedTime
    const remainingOperations = total - completed
    const remainingTime = remainingOperations / operationsPerMs

    callback({
      completed,
      total,
      success: stats.successfulOperations,
      failed: stats.failedOperations,
      remainingTime
    })
  }

  private finalizeStats(stats: BatchOperationStats): BatchOperationStats {
    stats.endTime = Date.now()
    return stats
  }
}

export const batchOperationManager = BatchOperationManager.getInstance()
