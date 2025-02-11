import { EventEmitter } from 'events'

interface RetryConfig {
  maxAttempts: number
  initialDelay: number
  maxDelay: number
  backoffFactor: number
  retryableErrors?: string[] // 可重试的错误类型
  nonRetryableErrors?: string[] // 不可重试的错误类型
}

interface ModelRetryStats {
  totalCalls: number
  successfulCalls: number
  failedCalls: number
  retryAttempts: number
  averageLatency: number
  errorTypes: Record<string, number> // 记录不同类型错误的次数
  lastError?: {
    type: string
    message: string
    timestamp: number
  }
}

export class ModelRetryManager extends EventEmitter {
  private static instance: ModelRetryManager
  private stats: Map<string, ModelRetryStats> = new Map()

  private readonly DEFAULT_CONFIG: RetryConfig = {
    maxAttempts: 3,
    initialDelay: 1000,
    maxDelay: 10000,
    backoffFactor: 2,
    retryableErrors: [
      'ETIMEDOUT',
      'ECONNRESET',
      'ECONNREFUSED',
      'RATE_LIMIT',
      'TIMEOUT',
      'NETWORK_ERROR',
      'SERVER_ERROR'
    ],
    nonRetryableErrors: ['INVALID_API_KEY', 'INVALID_REQUEST', 'CONTENT_POLICY', 'MODEL_NOT_FOUND']
  }

  private constructor() {
    super()
  }

  static getInstance(): ModelRetryManager {
    if (!ModelRetryManager.instance) {
      ModelRetryManager.instance = new ModelRetryManager()
    }
    return ModelRetryManager.instance
  }

  private shouldRetry(error: Error, config: RetryConfig): boolean {
    const errorType = this.getErrorType(error)

    // 如果在不可重试列表中，直接返回false
    if (config.nonRetryableErrors?.includes(errorType)) {
      return false
    }

    // 如果在可重试列表中，返回true
    if (config.retryableErrors?.includes(errorType)) {
      return true
    }

    // 默认处理逻辑
    if (error.message.includes('timeout') || error.message.includes('rate limit')) {
      return true
    }

    if (error.message.includes('invalid') || error.message.includes('not found')) {
      return false
    }

    // 默认可重试
    return true
  }

  private getErrorType(error: Error): string {
    // 处理常见的API错误类型
    if (error.message.includes('timeout')) return 'TIMEOUT'
    if (error.message.includes('rate limit')) return 'RATE_LIMIT'
    if (error.message.includes('network')) return 'NETWORK_ERROR'
    if (error.message.includes('api key')) return 'INVALID_API_KEY'
    if (error.message.includes('not found')) return 'MODEL_NOT_FOUND'
    if (error.message.includes('content policy')) return 'CONTENT_POLICY'

    // 处理HTTP错误
    if (error.message.includes('500')) return 'SERVER_ERROR'
    if (error.message.includes('400')) return 'INVALID_REQUEST'
    if (error.message.includes('401')) return 'UNAUTHORIZED'
    if (error.message.includes('403')) return 'FORBIDDEN'
    if (error.message.includes('429')) return 'RATE_LIMIT'

    return 'UNKNOWN_ERROR'
  }

  private calculateDelay(attempt: number, config: RetryConfig): number {
    return Math.min(config.initialDelay * Math.pow(config.backoffFactor, attempt - 1), config.maxDelay)
  }

  async executeWithRetry<T>(
    modelId: string,
    operation: () => Promise<T>,
    config: Partial<RetryConfig> = {}
  ): Promise<T> {
    const retryConfig = { ...this.DEFAULT_CONFIG, ...config }
    let lastError: Error | null = null
    const startTime = Date.now()

    // 初始化或更新统计信息
    if (!this.stats.has(modelId)) {
      this.stats.set(modelId, {
        totalCalls: 0,
        successfulCalls: 0,
        failedCalls: 0,
        retryAttempts: 0,
        averageLatency: 0,
        errorTypes: {}
      })
    }

    const stats = this.stats.get(modelId)!
    stats.totalCalls++

    for (let attempt = 1; attempt <= retryConfig.maxAttempts; attempt++) {
      try {
        const result = await operation()

        // 更新成功统计
        stats.successfulCalls++
        stats.averageLatency =
          (stats.averageLatency * (stats.successfulCalls - 1) + (Date.now() - startTime)) / stats.successfulCalls

        this.emit('success', {
          modelId,
          attempt,
          duration: Date.now() - startTime
        })

        return result
      } catch (error: any) {
        lastError = error
        const errorType = this.getErrorType(error)

        // 更新错误统计
        stats.errorTypes[errorType] = (stats.errorTypes[errorType] || 0) + 1
        stats.lastError = {
          type: errorType,
          message: error.message,
          timestamp: Date.now()
        }

        // 检查是否应该重试
        const shouldRetry = this.shouldRetry(error, retryConfig) && attempt < retryConfig.maxAttempts

        if (shouldRetry) {
          stats.retryAttempts++

          this.emit('retry', {
            modelId,
            attempt,
            error,
            errorType,
            willRetry: true,
            nextAttemptDelay: this.calculateDelay(attempt, retryConfig)
          })

          // 计算并等待重试延迟
          const delay = this.calculateDelay(attempt, retryConfig)
          await new Promise((resolve) => setTimeout(resolve, delay))
        } else {
          stats.failedCalls++

          this.emit('failure', {
            modelId,
            attempts: attempt,
            error,
            errorType,
            stats: this.getStats(modelId)
          })

          throw new Error(`模型调用失败 ${modelId}: ${error.message} (错误类型: ${errorType})`, { cause: error })
        }
      }
    }

    throw lastError
  }

  getStats(modelId: string): ModelRetryStats | undefined {
    return this.stats.get(modelId)
  }

  getAllStats(): Map<string, ModelRetryStats> {
    return new Map(this.stats)
  }

  clearStats(modelId?: string) {
    if (modelId) {
      this.stats.delete(modelId)
    } else {
      this.stats.clear()
    }
  }
}

export const modelRetryManager = ModelRetryManager.getInstance()
