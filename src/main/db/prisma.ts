import { PrismaClient } from '@prisma/client'

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined
}

// 初始化 Prisma 客户端，添加连接池配置
const prismaClient = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  // 添加连接池配置
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
      pooling: {
        min: 2,
        max: 10,
        idleTimeoutMs: 30000,
        acquireTimeoutMs: 60000
      }
    }
  }
})

// 在开发环境中将 prisma 客户端实例添加到全局对象中，方便调试
if (process.env.NODE_ENV !== 'production') {
  global.prisma = prismaClient
}

export const prisma = global.prisma || prismaClient

// 添加事务支持的辅助函数
export async function withTransaction<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
  return await prisma.$transaction(
    async (tx) => {
      try {
        return await fn(tx)
      } catch (error) {
        console.error('事务执行失败:', error)
        throw error
      }
    },
    {
      maxWait: 10000, // 最大等待时间
      timeout: 30000 // 事务超时时间
    }
  )
}

// 进程退出前清理连接
process.on('beforeExit', async () => {
  if (prisma) {
    await prisma.$disconnect()
  }
})
