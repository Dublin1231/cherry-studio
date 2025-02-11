import { MilvusClient } from '@zilliz/milvus2-sdk-node'

// 创建 Milvus 客户端实例
export const milvus = new MilvusClient(process.env.MILVUS_ADDRESS || 'localhost:19530')

// 导出类型
export type { MilvusClient }

// 在进程退出前清理 Milvus 客户端实例，确保资源正确释放
process.on('beforeExit', () => {
  if (global.milvus) {
    global.milvus = undefined
  }
})
