縤mport { DataType } from '@zilliz/milvus2-sdk-node'

import { milvus } from './milvus'
import { prisma } from './prisma'
import { shardBackupManager } from './shard-backup'
import { ShardInfo } from './shard-manager'

interface MigrationConfig {
  batchSize: number
  retryAttempts: number
  retryDelay: number // 濮ｎ偆顫�
}

interface MigrationTask {
  id: string
  sourceShard: ShardInfo
  targetShard: ShardInfo
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  progress: number
  error?: string
  startTime: Date
  endTime?: Date
}

export class ShardMigrationManager {
  private static instance: ShardMigrationManager
  private config: MigrationConfig
  private migrationTasks: Map<string, MigrationTask>

  private constructor(config: Partial<MigrationConfig> = {}) {
    this.config = {
      batchSize: config.batchSize || 100,
      retryAttempts: config.retryAttempts || 3,
      retryDelay: config.retryDelay || 5000 // 5缁�?
    }
    this.migrationTasks = new Map()
  }

  static getInstance(config?: Partial<MigrationConfig>): ShardMigrationManager {
    if (!ShardMigrationManager.instance) {
      ShardMigrationManager.instance = new ShardMigrationManager(config)
    }
    return ShardMigrationManager.instance
  }

  // 閸掓稑缂撴潻浣盒╂禒璇插
  async createMigrationTask(sourceShard: ShardInfo, targetShard: ShardInfo): Promise<string> {
    const taskId = `migration_${Date.now()}`
    const task: MigrationTask = {
      id: taskId,
      sourceShard,
      targetShard,
      status: 'pending',
      progress: 0,
      startTime: new Date()
    }

    this.migrationTasks.set(taskId, task)
    return taskId
  }

  // 瀵偓婵绺肩粔璁虫崲閸�?
  async startMigration(taskId: string): Promise<void> {
    const task = this.migrationTasks.get(taskId)
    if (!task) {
      throw new Error(`鏉╀胶些娴犺濮熸稉宥呯摠閸�? ${taskId}`)
    }

    try {
      task.status = 'in_progress'

      // 1. 閸掓稑缂撴径鍥﹀敜
      const backupPath = await shardBackupManager.backupShard(task.sourceShard)

      // 2. 鏉╀胶些閺佺増宓�
      await this.migrateData(task, backupPath)

      // 3. 妤犲矁鐦夋潻浣盒�
      await this.validateMigration(task)

      task.status = 'completed'
      task.progress = 100
      task.endTime = new Date()
    } catch (error: any) {
      task.status = 'failed'
      task.error = error.message
      throw error
    }
  }

  private async migrateData(task: MigrationTask, backupPath: string): Promise<void> {
    // 1. 鏉╀胶些缁旂姾濡弫鐗堝祦
    await this.migrateChapters(task)
    task.progress = 30

    // 2. 鏉╀胶些鐠佹澘绻傞柨姘卞仯
    await this.migrateMemoryAnchors(task)
    task.progress = 60

    // 3. 鏉╀胶些閸氭垿鍣洪弫鐗堝祦
    await this.migrateVectors(task)
    task.progress = 90
  }

  private async migrateChapters(task: MigrationTask): Promise<void> {
    const { sourceShard, targetShard } = task

    // 閸掑棙澹掗懢宄板絿閸滃矁绺肩粔鑽ょ彿閼�?
    let processedCount = 0
    while (true) {
      const chapters = await prisma.chapter.findMany({
        where: {
          number: {
            gte: sourceShard.startChapter,
            lte: sourceShard.endChapter
          }
        },
        skip: processedCount,
        take: this.config.batchSize
      })

      if (chapters.length === 0) break

      // 閺囧瓨鏌婄粩鐘哄Ν閸掑棛澧栨穱鈩冧紖
      await prisma.$transaction(
        chapters.map((chapter) =>
          prisma.chapter.update({
            where: { id: chapter.id },
            data: {
              // 閺囧瓨鏌婇崚鍡欏閻╃ǹ鍙ч惃鍕摟濞�?
              // 鏉╂瑩鍣烽棁鈧憰浣圭壌閹诡喖鐤勯梽鍛畱閺佺増宓佸Ο鈥崇€锋潻娑滎攽鐠嬪啯鏆�
            }
          })
        )
      )

      processedCount += chapters.length
    }
  }

  private async migrateMemoryAnchors(task: MigrationTask): Promise<void> {
    const { sourceShard, targetShard } = task

    let processedCount = 0
    while (true) {
      const memoryAnchors = await prisma.memoryAnchor.findMany({
        where: {
          chapter: {
            number: {
              gte: sourceShard.startChapter,
              lte: sourceShard.endChapter
            }
          }
        },
        include: {
          relations: true
        },
        skip: processedCount,
        take: this.config.batchSize
      })

      if (memoryAnchors.length === 0) break

      await prisma.$transaction(async (tx) => {
        for (const anchor of memoryAnchors) {
          const { relations, ...anchorData } = anchor

          // 閺囧瓨鏌婄拋鏉跨箓闁挎氨鍋�
          await tx.memoryAnchor.update({
            where: { id: anchor.id },
            data: {
              // 閺囧瓨鏌婇崚鍡欏閻╃ǹ鍙ч惃鍕摟濞�?
            }
          })

          // 閺囧瓨鏌婇崗宕囬兇
          if (relations) {
            for (const relation of relations) {
              await tx.memoryRelation.update({
                where: { id: relation.id },
                data: {
                  // 閺囧瓨鏌婇崚鍡欏閻╃ǹ鍙ч惃鍕摟濞�?
                }
              })
            }
          }
        }
      })

      processedCount += memoryAnchors.length
    }
  }

  private async migrateVectors(task: MigrationTask): Promise<void> {
    const { sourceShard } = task

    // 閼惧嘲褰囬棁鈧憰浣界讣缁夎崵娈戦崥鎴﹀櫤ID
    const memoryAnchors = await prisma.memoryAnchor.findMany({
      where: {
        chapter: {
          number: {
            gte: sourceShard.startChapter,
            lte: sourceShard.endChapter
          }
        }
      },
      select: { id: true, embedding: true }
    })

    const ids = memoryAnchors.map((m) => m.id)

    // 閹靛綊鍣烘潻浣盒╅崥鎴﹀櫤
    for (let i = 0; i < ids.length; i += this.config.batchSize) {
      const batchIds = ids.slice(i, i + this.config.batchSize)

      // 閼惧嘲褰囬崥鎴﹀櫤閺佺増宓�
      const vectors = await milvus.search({
        collection_name: 'memory_anchors',
        vectors: [], // 缁岀儤鐓＄拠銏ｅ箯閸欐牗澧嶉張澶嬫殶閹�?
        vector_type: DataType.FloatVector,
        limit: batchIds.length,
        expr: `id in [${batchIds.join(',')}]`
      })

      // 閺囧瓨鏌婇崥鎴﹀櫤閸掑棛澧栨穱鈩冧紖
      if (vectors.results.length > 0) {
        // 鐏忓棙鎮崇槐銏㈢波閺嬫粏娴嗛幑顫礋閹绘帒鍙嗛弽鐓庣础
        const vectorsToInsert = vectors.results.map((result, index) => ({
          id: result.id,
          embedding: memoryAnchors[index].embedding
            ? Array.from(new Float32Array(memoryAnchors[index].embedding!))
            : new Array(1536).fill(0) // 娴ｈ法鏁ゆ妯款吇閸氭垿鍣�
        }))

        await milvus.insert({
          collection_name: 'memory_anchors',
          data: vectorsToInsert
        })
      }
    }
  }

  private async validateMigration(task: MigrationTask): Promise<void> {
    const { sourceShard, targetShard } = task

    // 1. 妤犲矁鐦夌粩鐘哄Ν閺佷即鍣�
    const sourceChapterCount = await prisma.chapter.count({
      where: {
        number: {
          gte: sourceShard.startChapter,
          lte: sourceShard.endChapter
        }
      }
    })

    const targetChapterCount = await prisma.chapter.count({
      where: {
        number: {
          gte: targetShard.startChapter,
          lte: targetShard.endChapter
        }
      }
    })

    if (sourceChapterCount !== targetChapterCount) {
      throw new Error('缁旂姾濡弫浼村櫤娑撳秴灏柊?)
    }

    // 2. 妤犲矁鐦夌拋鏉跨箓闁挎氨鍋ｉ弫浼村櫤
    const sourceMemoryCount = await prisma.memoryAnchor.count({
      where: {
        chapter: {
          number: {
            gte: sourceShard.startChapter,
            lte: sourceShard.endChapter
          }
        }
      }
    })

    const targetMemoryCount = await prisma.memoryAnchor.count({
      where: {
        chapter: {
          number: {
            gte: targetShard.startChapter,
            lte: targetShard.endChapter
          }
        }
      }
    })

    if (sourceMemoryCount !== targetMemoryCount) {
      throw new Error('鐠佹澘绻傞柨姘卞仯閺佷即鍣烘稉宥呭爱闁�?)
    }

    // 3. 妤犲矁鐦夐崥鎴﹀櫤閺佺増宓�
    // 鏉╂瑩鍣烽棁鈧憰浣圭壌閹诡喖鐤勯梽鍛畱Milvus閺屻儴顕楅幒銉ュ經鏉╂稖顢戠拫鍐╂殻
  }

  // 閼惧嘲褰囨潻浣盒╂禒璇插閻樿埖鈧�?
  getMigrationStatus(taskId: string): MigrationTask | undefined {
    return this.migrationTasks.get(taskId)
  }

  // 閼惧嘲褰囬幍鈧張澶庣讣缁夎鎹㈤崝?
  getAllMigrationTasks(): MigrationTask[] {
    return Array.from(this.migrationTasks.values())
  }

  // 閸欐牗绉锋潻浣盒╂禒璇插
  async cancelMigration(taskId: string): Promise<void> {
    const task = this.migrationTasks.get(taskId)
    if (!task || task.status === 'completed') {
      return
    }

    task.status = 'failed'
    task.error = '娴犺濮熺悮顐㈠絿濞�?
    task.endTime = new Date()
  }

  // 濞撳懐鎮婂鎻掔暚閹存劗娈戞潻浣盒╂禒璇插鐠佹澘缍�
  cleanupCompletedTasks(maxAge: number = 7 * 24 * 60 * 60 * 1000): void {
    const now = Date.now()
    for (const [taskId, task] of this.migrationTasks.entries()) {
      if (task.status === 'completed' && task.endTime && now - task.endTime.getTime() > maxAge) {
        this.migrationTasks.delete(taskId)
      }
    }
  }
}

// 鐎电厧鍤崡鏇氱伐鐎圭偘绶�
export const shardMigrationManager = ShardMigrationManager.getInstance()
