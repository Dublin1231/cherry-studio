縤mport fs from 'fs'
import path from 'path'

import { milvus } from './milvus'
import { prisma } from './prisma'
import { ShardInfo } from './shard-manager'

interface BackupConfig {
  backupDir: string
  compressionLevel: number // 1-9
  maxBackupsPerShard: number
  backupInterval: number // 濮ｎ偆顫�
}

export class ShardBackupManager {
  private static instance: ShardBackupManager
  private config: BackupConfig
  private backupTasks: Map<string, NodeJS.Timeout>

  private constructor(config: Partial<BackupConfig> = {}) {
    this.config = {
      backupDir: config.backupDir || 'backups/shards',
      compressionLevel: config.compressionLevel || 6,
      maxBackupsPerShard: config.maxBackupsPerShard || 3,
      backupInterval: config.backupInterval || 24 * 60 * 60 * 1000 // 姒涙ǹ顓�24鐏忓繑妞�
    }
    this.backupTasks = new Map()
    this.ensureBackupDir()
  }

  static getInstance(config?: Partial<BackupConfig>): ShardBackupManager {
    if (!ShardBackupManager.instance) {
      ShardBackupManager.instance = new ShardBackupManager(config)
    }
    return ShardBackupManager.instance
  }

  private ensureBackupDir() {
    if (!fs.existsSync(this.config.backupDir)) {
      fs.mkdirSync(this.config.backupDir, { recursive: true })
    }
  }

  // 瀵偓婵鐣鹃張鐔奉槵娴犳垝鎹㈤崝?
  startBackupTask(shardInfo: ShardInfo) {
    if (this.backupTasks.has(shardInfo.id)) {
      return // 娴犺濮熷鎻掔摠閸�?
    }

    const task = setInterval(() => this.backupShard(shardInfo), this.config.backupInterval)
    this.backupTasks.set(shardInfo.id, task)
  }

  // 閸嬫粍顒涚€规碍婀℃径鍥﹀敜娴犺濮�
  stopBackupTask(shardId: string) {
    const task = this.backupTasks.get(shardId)
    if (task) {
      clearInterval(task)
      this.backupTasks.delete(shardId)
    }
  }

  // 婢跺洣鍞ら崡鏇氶嚋閸掑棛澧�
  async backupShard(shardInfo: ShardInfo): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupDir = path.join(this.config.backupDir, shardInfo.id)
    const backupPath = path.join(backupDir, `backup_${timestamp}`)

    try {
      // 閸掓稑缂撴径鍥﹀敜閻╊喖缍�
      fs.mkdirSync(backupPath, { recursive: true })

      // 婢跺洣鍞ょ粩鐘哄Ν閺佺増宓�
      await this.backupChapters(shardInfo, backupPath)

      // 婢跺洣鍞ょ拋鏉跨箓闁挎氨鍋�
      await this.backupMemoryAnchors(shardInfo, backupPath)

      // 婢跺洣鍞ら崥鎴﹀櫤閺佺増宓�
      await this.backupVectors(shardInfo, backupPath)

      // 閸愭瑥鍙嗘径鍥﹀敜娣団剝浼�
      const backupInfo = {
        timestamp,
        shardId: shardInfo.id,
        startChapter: shardInfo.startChapter,
        endChapter: shardInfo.endChapter,
        recordCount: shardInfo.recordCount
      }
      fs.writeFileSync(path.join(backupPath, 'backup-info.json'), JSON.stringify(backupInfo, null, 2))

      // 濞撳懐鎮婇弮褍顦禒?
      await this.cleanOldBackups(shardInfo.id)

      return backupPath
    } catch (error) {
      console.error(`婢跺洣鍞ら崚鍡欏 ${shardInfo.id} 婢惰精瑙�:`, error)
      throw error
    }
  }

  private async backupChapters(shardInfo: ShardInfo, backupPath: string) {
    const chapters = await prisma.chapter.findMany({
      where: {
        number: {
          gte: shardInfo.startChapter,
          lte: shardInfo.endChapter
        }
      }
    })

    fs.writeFileSync(path.join(backupPath, 'chapters.json'), JSON.stringify(chapters, null, 2))
  }

  private async backupMemoryAnchors(shardInfo: ShardInfo, backupPath: string) {
    const memoryAnchors = await prisma.memoryAnchor.findMany({
      where: {
        chapter: {
          number: {
            gte: shardInfo.startChapter,
            lte: shardInfo.endChapter
          }
        }
      },
      include: {
        relations: true
      }
    })

    fs.writeFileSync(path.join(backupPath, 'memory_anchors.json'), JSON.stringify(memoryAnchors, null, 2))
  }

  private async backupVectors(shardInfo: ShardInfo, backupPath: string) {
    // 閼惧嘲褰囬崚鍡欏娑擃厾娈戦幍鈧張澶庮唶韫囧棝鏁嬮悙绗紻
    const memoryAnchors = await prisma.memoryAnchor.findMany({
      where: {
        chapter: {
          number: {
            gte: shardInfo.startChapter,
            lte: shardInfo.endChapter
          }
        }
      },
      select: { id: true }
    })

    const ids = memoryAnchors.map((m) => m.id)

    // 娴犲懂ilvus閼惧嘲褰囬崥鎴﹀櫤閺佺増宓�
    if (ids.length > 0) {
      const vectors = await milvus.search({
        collection_name: 'memory_anchors',
        vectors: [], // 缁岀儤鐓＄拠銏ｅ箯閸欐牗澧嶉張澶嬫殶閹�?
        vector_type: 'FloatVector',
        limit: ids.length,
        expr: `id in [${ids.join(',')}]`
      })

      fs.writeFileSync(path.join(backupPath, 'vectors.json'), JSON.stringify(vectors, null, 2))
    }
  }

  // 娴犲骸顦禒鑺ヤ划婢跺秴鍨庨悧?
  async restoreFromBackup(backupPath: string): Promise<void> {
    try {
      // 鐠囪褰囨径鍥﹀敜娣団剝浼�
      const backupInfo = JSON.parse(fs.readFileSync(path.join(backupPath, 'backup-info.json'), 'utf-8'))

      // 閹垹顦茬粩鐘哄Ν閺佺増宓�
      await this.restoreChapters(backupPath)

      // 閹垹顦茬拋鏉跨箓闁挎氨鍋�
      await this.restoreMemoryAnchors(backupPath)

      // 閹垹顦查崥鎴﹀櫤閺佺増宓�
      await this.restoreVectors(backupPath)

      console.log(`閹存劕濮涙禒搴☆槵娴犺姤浠径宥呭瀻閻�?${backupInfo.shardId}`)
    } catch (error) {
      console.error('閹垹顦叉径鍥﹀敜婢惰精瑙�:', error)
      throw error
    }
  }

  private async restoreChapters(backupPath: string) {
    const chapters = JSON.parse(fs.readFileSync(path.join(backupPath, 'chapters.json'), 'utf-8'))

    await prisma.$transaction(
      chapters.map((chapter: any) =>
        prisma.chapter.upsert({
          where: { id: chapter.id },
          create: chapter,
          update: chapter
        })
      )
    )
  }

  private async restoreMemoryAnchors(backupPath: string) {
    const memoryAnchors = JSON.parse(fs.readFileSync(path.join(backupPath, 'memory_anchors.json'), 'utf-8'))

    await prisma.$transaction(async (tx) => {
      for (const anchor of memoryAnchors) {
        const { relations, ...anchorData } = anchor

        // 閹垹顦茬拋鏉跨箓闁挎氨鍋�
        await tx.memoryAnchor.upsert({
          where: { id: anchor.id },
          create: anchorData,
          update: anchorData
        })

        // 閹垹顦查崗宕囬兇
        if (relations) {
          for (const relation of relations) {
            await tx.memoryRelation.upsert({
              where: { id: relation.id },
              create: relation,
              update: relation
            })
          }
        }
      }
    })
  }

  private async restoreVectors(backupPath: string) {
    if (!fs.existsSync(path.join(backupPath, 'vectors.json'))) {
      return
    }

    const vectors = JSON.parse(fs.readFileSync(path.join(backupPath, 'vectors.json'), 'utf-8'))

    if (vectors.length > 0) {
      await milvus.insert({
        collection_name: 'memory_anchors',
        data: vectors
      })
    }
  }

  private async cleanOldBackups(shardId: string) {
    const backupDir = path.join(this.config.backupDir, shardId)
    if (!fs.existsSync(backupDir)) {
      return
    }

    const backups = fs
      .readdirSync(backupDir)
      .filter((name) => name.startsWith('backup_'))
      .sort()
      .reverse()

    // 閸掔娀娅庣搾鍛毉闂勬劕鍩楅惃鍕＋婢跺洣鍞�
    for (let i = this.config.maxBackupsPerShard; i < backups.length; i++) {
      const backupPath = path.join(backupDir, backups[i])
      fs.rmSync(backupPath, { recursive: true })
    }
  }

  // 閼惧嘲褰囬崚鍡欏閻ㄥ嫭澧嶉張澶婎槵娴�?
  listBackups(shardId: string): Array<{
    path: string
    timestamp: string
    recordCount: number
  }> {
    const backupDir = path.join(this.config.backupDir, shardId)
    if (!fs.existsSync(backupDir)) {
      return []
    }

    return fs
      .readdirSync(backupDir)
      .filter((name) => name.startsWith('backup_'))
      .map((name) => {
        const backupPath = path.join(backupDir, name)
        const info = JSON.parse(fs.readFileSync(path.join(backupPath, 'backup-info.json'), 'utf-8'))
        return {
          path: backupPath,
          timestamp: info.timestamp,
          recordCount: info.recordCount
        }
      })
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
  }
}

// 鐎电厧鍤崡鏇氱伐鐎圭偘绶�
export const shardBackupManager = ShardBackupManager.getInstance()
