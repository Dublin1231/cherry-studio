import { PrismaClient } from '@prisma/client'
import { DataType, MilvusClient } from '@zilliz/milvus2-sdk-node'

const prisma = new PrismaClient()
const milvus = new MilvusClient('localhost:19530')

export class NovelService {
  // 小说相关操作
  async createNovel(data: { title: string; author: string; description?: string; settings?: any }) {
    return prisma.novel.create({ data })
  }

  async getNovel(id: string) {
    return prisma.novel.findUnique({
      where: { id },
      include: { chapters: true }
    })
  }

  async updateNovel(id: string, data: { title?: string; description?: string; settings?: any }) {
    return prisma.novel.update({
      where: { id },
      data
    })
  }

  // 章节相关操作
  async createChapter(data: { novelId: string; number: number; title: string; content: string }) {
    return prisma.chapter.create({ data })
  }

  async updateChapter(id: string, data: { title?: string; content?: string; status?: string }) {
    return prisma.chapter.update({
      where: { id },
      data
    })
  }

  async getChapter(id: string) {
    return prisma.chapter.findUnique({
      where: { id },
      include: { memories: true }
    })
  }

  // 记忆锚点操作
  async createMemoryAnchor(data: {
    novelId: string
    chapterId: string
    type: string
    content: string
    embedding?: Buffer
    weight?: number
  }) {
    const memoryAnchor = await prisma.memoryAnchor.create({ data })

    // 如果有向量嵌入，存入Milvus
    if (data.embedding) {
      await milvus.insert({
        collection_name: 'memory_anchors',
        data: [
          {
            id: memoryAnchor.id,
            embedding: new Float32Array(data.embedding)
          }
        ]
      })
    }

    return memoryAnchor
  }

  async searchSimilarMemories(embedding: Buffer, limit: number = 10) {
    const results = await milvus.search({
      collection_name: 'memory_anchors',
      vectors: [Array.from(new Float32Array(embedding))],
      vector_type: DataType.FloatVector,
      limit
    })

    // 获取完整的记忆锚点数据
    const ids = results.results.map((r) => r.id)
    return prisma.memoryAnchor.findMany({
      where: { id: { in: ids } }
    })
  }

  // 记忆关系操作
  async createMemoryRelation(data: { sourceId: string; targetId: string; type: string; weight?: number }) {
    return prisma.memoryRelation.create({ data })
  }

  // 伏笔管理操作
  async createForeshadowing(data: { novelId: string; content: string; plantedAt: number; expectedAt: number }) {
    return prisma.foreshadowing.create({ data })
  }

  async updateForeshadowingStatus(id: string, status: 'planted' | 'recalled') {
    return prisma.foreshadowing.update({
      where: { id },
      data: { status }
    })
  }

  async getPendingForeshadowings(novelId: string, currentChapter: number) {
    return prisma.foreshadowing.findMany({
      where: {
        novelId,
        status: 'planted',
        expectedAt: { lte: currentChapter }
      }
    })
  }

  // 获取记忆锚点
  async getMemoryAnchors(novelId: string, startChapter: number, endChapter: number) {
    return prisma.memoryAnchor.findMany({
      where: {
        novelId,
        chapter: {
          number: {
            gte: startChapter,
            lte: endChapter
          }
        }
      },
      include: {
        relations: true
      }
    })
  }

  // 根据ID获取记忆锚点
  async getMemoryAnchorsByIds(ids: string[]) {
    return prisma.memoryAnchor.findMany({
      where: {
        id: {
          in: ids
        }
      },
      include: {
        relations: true
      }
    })
  }

  // 更新记忆锚点
  async updateMemoryAnchor(id: string, data: { weight?: number; content?: string }) {
    return prisma.memoryAnchor.update({
      where: { id },
      data
    })
  }
}

export const novelService = new NovelService()
