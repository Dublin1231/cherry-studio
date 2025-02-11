import { milvus } from './milvus'
import { prisma } from './prisma'

export class DatabaseConnectionManager {
  private static instance: DatabaseConnectionManager
  private isConnected: boolean = false
  private connectionRetries: number = 0
  private readonly MAX_RETRIES = 3
  private readonly RETRY_INTERVAL = 5000 // 5秒
  private constructor() {
    // 初始化时设置连接状态为未连接
    this.isConnected = false
  }

  static getInstance(): DatabaseConnectionManager {
    if (!DatabaseConnectionManager.instance) {
      DatabaseConnectionManager.instance = new DatabaseConnectionManager()
    }
    return DatabaseConnectionManager.instance
  }

  async connect(): Promise<void> {
    try {
      // 连接 Prisma 数据库
      await prisma.$connect()

      // 连接 Milvus 数据库
      await this.testMilvusConnection()

      this.isConnected = true
      this.connectionRetries = 0
      console.log('数据库连接成功')
    } catch (error: unknown) {
      console.error('数据库连接失败:', error instanceof Error ? error.message : String(error))
      await this.handleConnectionError()
    }
  }

  private async testMilvusConnection(): Promise<void> {
    try {
      // 测试是否可以访问集合来验证连接
      await milvus.hasCollection('memory_anchors')
    } catch (error: unknown) {
      throw new Error(`Milvus 数据库连接测试失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private async handleConnectionError(): Promise<void> {
    if (this.connectionRetries < this.MAX_RETRIES) {
      this.connectionRetries++
      console.log(`尝试重新连接 (${this.connectionRetries}/${this.MAX_RETRIES})...`)
      await new Promise((resolve) => setTimeout(resolve, this.RETRY_INTERVAL))
      await this.connect()
    } else {
      throw new Error('数据库连接失败次数超过最大重试次数限制')
    }
  }

  async disconnect(): Promise<void> {
    try {
      await prisma.$disconnect()
      // Milvus 客户端没有提供显式的断开连接方法
      this.isConnected = false
      console.log('数据库连接已断开')
    } catch (error: unknown) {
      console.error('断开数据库连接时发生错误:', error instanceof Error ? error.message : String(error))
      throw error
    }
  }

  async healthCheck(): Promise<{
    prisma: boolean
    milvus: boolean
  }> {
    const health = {
      prisma: false,
      milvus: false
    }

    try {
      // 检查 Prisma 连接
      await prisma.$queryRaw`SELECT 1`
      health.prisma = true
    } catch (error: unknown) {
      console.error('Prisma 健康检查失败:', error instanceof Error ? error.message : String(error))
    }

    try {
      // 检查 Milvus 连接
      await milvus.hasCollection('memory_anchors')
      health.milvus = true
    } catch (error: unknown) {
      console.error('Milvus 健康检查失败:', error instanceof Error ? error.message : String(error))
    }

    return health
  }

  isHealthy(): boolean {
    return this.isConnected
  }

  getConnectionStats(): {
    isConnected: boolean
    retryCount: number
  } {
    return {
      isConnected: this.isConnected,
      retryCount: this.connectionRetries
    }
  }
}

// 导出单例实例
export const dbManager = DatabaseConnectionManager.getInstance()
