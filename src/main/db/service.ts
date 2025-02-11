縤mport { DataType } from '@zilliz/milvus2-sdk-node'

import { milvus } from './milvus'
import { prisma } from './prisma'
import { shardManager } from './shard-manager'

export class NovelService {
  // 娴ｈ法鏁ゆ禍瀣閸掓稑缂撶亸蹇氼嚛閸欏﹤鍙鹃惄绋垮彠閺佺増宓�
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
      // 閸掓稑缂撶亸蹇氼嚛
      const novel = await tx.novel.create({
        data: {
          title: data.title,
          author: data.author,
          description: data.description,
          settings: data.settings
        }
      })

      // 婵″倹鐏夐幓鎰返娴滃棛顑囨稉鈧粩鐘插敶鐎圭櫢绱濋崚娑樼紦缁楊兛绔寸粩?      if (data.firstChapter) {
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

  // 娴ｈ法鏁ゆ禍瀣閺囧瓨鏌婄亸蹇氼嚛閸欏﹤鍙剧粩鐘哄Ν
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
      // 閺囧瓨鏌婄亸蹇氼嚛閸╃儤婀版穱鈩冧紖
      const novel = await tx.novel.update({
        where: { id: novelId },
        data: {
          title: data.title,
          description: data.description,
          settings: data.settings
        }
      })

      // 婵″倹鐏夐幓鎰返娴滃棛鐝烽懞鍌涙纯閺傚府绱濋幍褰掑櫤閺囧瓨鏌婄粩鐘哄Ν
      if (data.chapters) {
        for (const chapter of data.chapters) {
          if (chapter.id) {
            // 閺囧瓨鏌婇悳鐗堟箒缁旂姾濡�
            await tx.chapter.update({
              where: { id: chapter.id },
              data: {
                number: chapter.number,
                title: chapter.title,
                content: chapter.content
              }
            })
          } else {
            // 閸掓稑缂撻弬鎵彿閼�?            await tx.chapter.create({
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

  // 娴ｈ法鏁ゆ禍瀣閸掓稑缂撶拋鏉跨箓闁挎氨鍋ｉ崣濠傚従閸忓磭閮�
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
      // 閸掓稑缂撶拋鏉跨箓闁挎氨鍋�
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

      // 婵″倹鐏夐張澶婃倻闁插繐绁甸崗銉礉鐎涙ê鍙哅ilvus
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

      // 閸掓稑缂撻崗宕囬兇
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

  // 娴ｈ法鏁ゆ禍瀣閸掔娀娅庣亸蹇氼嚛閸欏﹤鍙鹃幍鈧張澶屾祲閸忚櫕鏆熼幑?  async deleteNovelWithTransaction(novelId: string) {
    return prisma.$transaction(async (tx) => {
      // 閼惧嘲褰囬幍鈧張澶屾祲閸忓磭娈戠拋鏉跨箓闁挎氨鍋D
      const memoryAnchors = await tx.memoryAnchor.findMany({
        where: { novelId },
        select: { id: true }
      })

      // 閸掔娀娅庣拋鏉跨箓閸忓磭閮�
      await tx.memoryRelation.deleteMany({
        where: {
          OR: [
            { sourceId: { in: memoryAnchors.map((m) => m.id) } },
            { targetId: { in: memoryAnchors.map((m) => m.id) } }
          ]
        }
      })

      // 閸掔娀娅庣拋鏉跨箓闁挎氨鍋�
      await tx.memoryAnchor.deleteMany({
        where: { novelId }
      })

      // 閸掔娀娅庢导蹇曠應
      await tx.foreshadowing.deleteMany({
        where: { novelId }
      })

      // 閸掔娀娅庣粩鐘哄Ν
      await tx.chapter.deleteMany({
        where: { novelId }
      })

      // 閸掔娀娅庣亸蹇氼嚛
      await tx.novel.delete({
        where: { id: novelId }
      })

      // 娴犲懂ilvus娑擃厼鍨归梽銈囨祲閸忓啿鎮滈柌?      // 濞夈劍鍓伴敍姘崇箹闁插奔绗夐懗钘夊瘶閸氼偄婀禍瀣娑擃叏绱濋崶鐘辫礋Milvus娑撳秵鏁幐浣风皑閸�?      // 婵″倹鐏塎ilvus閹垮秳缍旀径杈Е閿涘苯褰叉禒銉┾偓姘崇箖閸氬骸褰存禒璇插濞撳懐鎮�
      try {
        for (const anchor of memoryAnchors) {
          await milvus.delete({
            collection_name: 'memory_anchors',
            ids: [anchor.id]
          })
        }
      } catch (error) {
        console.error('娴犲懂ilvus閸掔娀娅庨崥鎴﹀櫤婢惰精瑙�:', error)
        // 鐠佹澘缍嶆径杈Е閻ㄥ嫬鍨归梽銈嗘惙娴ｆ粣绱濇禒銉ょ┒閸氬海鐢诲〒鍛倞
      }
    })
  }

  // 鐏忓繗顕╅惄绋垮彠閹垮秳缍�
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

  // 缁旂姾濡惄绋垮彠閹垮秳缍�
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

  // 鐠佹澘绻傞柨姘卞仯閹垮秳缍�
  async createMemoryAnchor(data: {
    novelId: string
    chapterId: string
    type: string
    content: string
    embedding?: Buffer
    weight?: number
  }) {
    const memoryAnchor = await prisma.memoryAnchor.create({ data })

    // 婵″倹鐏夐張澶婃倻闁插繐绁甸崗銉礉鐎涙ê鍙哅ilvus
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

    // 閼惧嘲褰囩€瑰本鏆ｉ惃鍕唶韫囧棝鏁嬮悙瑙勬殶閹�?    const ids = results.results.map((r) => r.id)
    return prisma.memoryAnchor.findMany({
      where: { id: { in: ids } }
    })
  }

  // 鐠佹澘绻傞崗宕囬兇閹垮秳缍�
  async createMemoryRelation(data: { sourceId: string; targetId: string; type: string; weight?: number }) {
    return prisma.memoryRelation.create({ data })
  }

  // 娴煎繒鐟粻锛勬倞閹垮秳缍�
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

  // 閼惧嘲褰囩拋鏉跨箓闁挎氨鍋�
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

  // 閺嶈宓両D閼惧嘲褰囩拋鏉跨箓闁挎氨鍋�
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

  // 閺囧瓨鏌婄拋鏉跨箓闁挎氨鍋�
  async updateMemoryAnchor(id: string, data: { weight?: number; content?: string }) {
    return prisma.memoryAnchor.update({
      where: { id },
      data
    })
  }

  // 娴ｈ法鏁ら崚鍡欏鐎涙ê鍋嶇粩鐘哄Ν
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

  // 娴犲骸鍨庨悧鍥嚢閸欐牜鐝烽懞?  async getChapterWithSharding(novelId: string, chapterNumber: number) {
    return shardManager.readChapterFromShard(novelId, chapterNumber)
  }

  // 閼惧嘲褰囬崚鍡欏缂佺喕顓告穱鈩冧紖
  async getShardingStats() {
    return shardManager.getShardStats()
  }

  // 濞撳懐鎮婃潻鍥ㄦ埂閸掑棛澧�
  async cleanupStaleShards(maxAgeHours: number = 24) {
    return shardManager.cleanupStaleShards(maxAgeHours * 60 * 60 * 1000)
  }
}

export const novelService = new NovelService()
