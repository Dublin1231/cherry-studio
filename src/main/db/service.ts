import { DataType } from '@zilliz/milvus2-sdk-node'

import { milvus } from './milvus'
import { prisma } from './prisma'
import { shardManager } from './shard-manager'

export class NovelService {
  // 使用事务创建小说及其相关数据
  async createNovelWithTransaction(data: {
    title: string
    author: string
    description?: string
    settings?: any
    firstChapter?: {
      title: string
      content: string
    }
  }) {
    return prisma.$transaction(async (tx) => {
      // 创建小说
      const novel = await tx.novel.create({
        data: {
          title: data.title,
          author: data.author,
          description: data.description,
          settings: data.settings
        }
      })

      // 如果提供了第一章内容，创建第一�?      if (data.firstChapter) {
        await tx.chapter.create({
          data: {
            novelId: novel.id,
            number: 1,
            title: data.firstChapter.title,
            content: data.firstChapter.content
          }
        })
      }

      return novel
    })
  }

  // 使用事务更新小说及其章节
  async updateNovelAndChaptersWithTransaction(
    novelId: string,
    data: {
      title?: string
      description?: string
      settings?: any
      chapters?: Array<{
        id?: string
        number: number
        title: string
        content: string
      }>
    }
  ) {
    return prisma.$transaction(async (tx) => {
      // 更新小说基本信息
      const novel = await tx.novel.update({
        where: { id: novelId },
        data: {
          title: data.title,
          description: data.description,
          settings: data.settings
        }
      })

      // 如果提供了章节更新，批量更新章节
      if (data.chapters) {
        for (const chapter of data.chapters) {
          if (chapter.id) {
            // 更新现有章节
            await tx.chapter.update({
              where: { id: chapter.id },
              data: {
                number: chapter.number,
                title: chapter.title,
                content: chapter.content
              }
            })
          } else {
            // 创建新章�?            await tx.chapter.create({
              data: {
                novelId,
                number: chapter.number,
                title: chapter.title,
                content: chapter.content
              }
            })
          }
        }
      }

      return novel
    })
  }

  // 使用事务创建记忆锚点及其关系
  async createMemoryAnchorWithRelations(data: {
    novelId: string
    chapterId: string
    type: string
    content: string
    embedding?: Buffer
    weight?: number
    relations?: Array<{
      targetId: string
      type: string
      weight?: number
    }>
  }) {
    return prisma.$transaction(async (tx) => {
      // 创建记忆锚点
      const memoryAnchor = await tx.memoryAnchor.create({
        data: {
          novelId: data.novelId,
          chapterId: data.chapterId,
          type: data.type,
          content: data.content,
          embedding: data.embedding,
          weight: data.weight
        }
      })

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

      // 创建关系
      if (data.relations) {
        for (const relation of data.relations) {
          await tx.memoryRelation.create({
            data: {
              sourceId: memoryAnchor.id,
              targetId: relation.targetId,
              type: relation.type,
              weight: relation.weight
            }
          })
        }
      }

      return memoryAnchor
    })
  }

  // 使用事务删除小说及其所有相关数�?  async deleteNovelWithTransaction(novelId: string) {
    return prisma.$transaction(async (tx) => {
      // 获取所有相关的记忆锚点ID
      const memoryAnchors = await tx.memoryAnchor.findMany({
        where: { novelId },
        select: { id: true }
      })

      // 删除记忆关系
      await tx.memoryRelation.deleteMany({
        where: {
          OR: [
            { sourceId: { in: memoryAnchors.map((m) => m.id) } },
            { targetId: { in: memoryAnchors.map((m) => m.id) } }
          ]
        }
      })

      // 删除记忆锚点
      await tx.memoryAnchor.deleteMany({
        where: { novelId }
      })

      // 删除伏笔
      await tx.foreshadowing.deleteMany({
        where: { novelId }
      })

      // 删除章节
      await tx.chapter.deleteMany({
        where: { novelId }
      })

      // 删除小说
      await tx.novel.delete({
        where: { id: novelId }
      })

      // 从Milvus中删除相关向�?      // 注意：这里不能包含在事务中，因为Milvus不支持事�?      // 如果Milvus操作失败，可以通过后台任务清理
      try {
        for (const anchor of memoryAnchors) {
          await milvus.delete({
            collection_name: 'memory_anchors',
            ids: [anchor.id]
          })
        }
      } catch (error) {
        console.error('从Milvus删除向量失败:', error)
        // 记录失败的删除操作，以便后续清理
      }
    })
  }

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

    // 获取完整的记忆锚点数�?    const ids = results.results.map((r) => r.id)
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

  // 使用分片存储章节
  async createChapterWithSharding(data: {
    novelId: string
    number: number
    title: string
    content: string
    memories?: Array<{
      type: string
      content: string
      embedding?: number[]
    }>
  }) {
    return shardManager.storeChapterInShard(data.novelId, data.number, {
      title: data.title,
      content: data.content,
      memories: data.memories
    })
  }

  // 从分片读取章�?  async getChapterWithSharding(novelId: string, chapterNumber: number) {
    return shardManager.readChapterFromShard(novelId, chapterNumber)
  }

  // 获取分片统计信息
  async getShardingStats() {
    return shardManager.getShardStats()
  }

  // 清理过期分片
  async cleanupStaleShards(maxAgeHours: number = 24) {
    return shardManager.cleanupStaleShards(maxAgeHours * 60 * 60 * 1000)
  }
}

export const novelService = new NovelService()
