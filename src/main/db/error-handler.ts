import { EventEmitter } from 'events'

// 错误处理上下文类型
interface ErrorContext {
  context: string
  collection?: string
  operation?: string
  details?: Record<string, unknown>
}

// 错误处理器类
class ErrorHandler extends EventEmitter {
  // 处理错误
  handleError(error: Error, context: ErrorContext): void {
    // 记录错误
    console.error('Error occurred:', {
      message: error.message,
      stack: error.stack,
      ...context
    })

    // 发出错误事件
    this.emit('error', {
      error,
      context,
      timestamp: new Date()
    })
  }

  // 获取错误详情
  getErrorDetails(error: Error): Record<string, unknown> {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: error.cause
    }
  }
}

// 导出单例实例
export const errorHandler = new ErrorHandler()
