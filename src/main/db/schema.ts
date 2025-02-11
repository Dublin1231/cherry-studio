import { milvus } from './milvus'
import { prisma } from './prisma'

export class NovelService {
  // 创建小说及其第一章
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

      // 如果有第一章，创建第一章
      if (data.firstChapter) {
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

  // 更新小说和章节
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

      // 更新或创建章节
      if (data.chapters) {
        for (const chapter of data.chapters) {
          if (chapter.id) {
            // 更新已有章节
            await tx.chapter.update({
              where: { id: chapter.id },
              data: {
                number: chapter.number,
                title: chapter.title,
                content: chapter.content
              }
            })
          } else {
            // 创建新章节
            await tx.chapter.create({
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

  // 创建记忆锚点及其关系
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

      // 如果有向量嵌入，存入 Milvus
      if (data.embedding) {
        await milvus.insert({
          collection_name: 'memory_anchors',
          data: [
            {
              id: memoryAnchor.id,
              embedding: Array.from(new Float32Array(data.embedding))
            }
          ]
        })
      }

      return memoryAnchor
    })
  }

  // 创建小说
  async createNovel(data: { title: string; author: string; description?: string; settings?: any }) {
    return prisma.novel.create({ data })
  }

  // 获取小说
  async getNovel(id: string) {
    return prisma.novel.findUnique({
      where: { id },
      include: { chapters: true }
    })
  }

  // 更新小说
  async updateNovel(id: string, data: { title?: string; description?: string; settings?: any }) {
    return prisma.novel.update({
      where: { id },
      data
    })
  }

  // 创建章节
  async createChapter(data: { novelId: string; number: number; title: string; content: string }) {
    return prisma.chapter.create({ data })
  }

  // 更新章节
  async updateChapter(id: string, data: { title?: string; content?: string; status?: string }) {
    return prisma.chapter.update({
      where: { id },
      data
    })
  }

  // 获取章节
  async getChapter(id: string) {
    return prisma.chapter.findUnique({
      where: { id },
      include: { memories: true }
    })
  }
}

// 导出单例实例
export const novelService = new NovelService()
