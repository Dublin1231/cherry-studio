import { DataType } from '@zilliz/milvus2-sdk-node'
import fs from 'fs'
import path from 'path'

import { milvus } from './milvus'
import { prisma } from './prisma'

export class DatabaseBackupManager {
  private backupDir: string
  private readonly MAX_BACKUPS = 5 // 最大备份数量限制
  constructor(backupDir: string = 'backups') {
    this.backupDir = backupDir
    this.ensureBackupDir()
  }

  private ensureBackupDir() {
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true })
    }
  }

  async createBackup(note: string = ''): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupName = `backup_${timestamp}`
    const backupPath = path.join(this.backupDir, backupName)

    try {
      // 创建备份目录
      fs.mkdirSync(backupPath)

      // 备份 SQLite 数据库
      await this.backupSqliteDb(backupPath)

      // 备份 Milvus 集合
      await this.backupMilvusCollections(backupPath)

      // 保存备份信息
      const backupInfo = {
        timestamp,
        note,
        collections: ['novel.db', 'memory_anchors'],
        version: '1.0'
      }
      fs.writeFileSync(path.join(backupPath, 'backup-info.json'), JSON.stringify(backupInfo, null, 2))

      // 清理旧备份
      await this.cleanOldBackups()

      return backupName
    } catch (error) {
      console.error('创建备份失败:', error)
      throw error
    }
  }

  private async backupSqliteDb(backupPath: string) {
    const dbPath = 'novel.db'
    const backupDbPath = path.join(backupPath, 'novel.db')

    // 断开 Prisma 连接
    await prisma.$disconnect()

    // 复制数据库文件
    fs.copyFileSync(dbPath, backupDbPath)

    // 重新连接 Prisma
    await prisma.$connect()
  }

  private async backupMilvusCollections(backupPath: string) {
    try {
      // 获取 memory_anchors 集合中的所有数据
      const memoryAnchors = await milvus.search({
        collection_name: 'memory_anchors',
        vectors: [], // 空向量将返回所有数据
        vector_type: DataType.FloatVector,
        limit: 10000 // 设置合适的限制以获取所有数据
      })

      // 保存向量数据
      fs.writeFileSync(path.join(backupPath, 'memory_anchors.json'), JSON.stringify(memoryAnchors, null, 2))
    } catch (error) {
      console.error('备份 Milvus 集合失败:', error)
      throw error
    }
  }

  async restoreFromBackup(backupName: string): Promise<void> {
    const backupPath = path.join(this.backupDir, backupName)

    if (!fs.existsSync(backupPath)) {
      throw new Error(`备份 ${backupName} 不存在`)
    }

    try {
      // 读取备份信息
      const backupInfo = JSON.parse(fs.readFileSync(path.join(backupPath, 'backup-info.json'), 'utf-8'))

      // 验证备份版本
      if (backupInfo.version !== '1.0') {
        throw new Error(`不支持的备份版本: ${backupInfo.version}`)
      }

      // 恢复 SQLite 数据库
      await this.restoreSqliteDb(backupPath)

      // 恢复 Milvus 集合
      await this.restoreMilvusCollections(backupPath)

      console.log(`从备份 ${backupName} 恢复成功`)
    } catch (error) {
      console.error('恢复备份失败:', error)
      throw error
    }
  }

  private async restoreSqliteDb(backupPath: string) {
    const dbPath = 'novel.db'
    const backupDbPath = path.join(backupPath, 'novel.db')

    // 断开 Prisma 连接
    await prisma.$disconnect()

    // 复制数据库文件
    fs.copyFileSync(backupDbPath, dbPath)

    // 重新连接 Prisma
    await prisma.$connect()
  }

  private async restoreMilvusCollections(backupPath: string) {
    try {
      // 读取向量数据
      const memoryAnchors = JSON.parse(fs.readFileSync(path.join(backupPath, 'memory_anchors.json'), 'utf-8'))

      // 删除现有集合（如果需要的话）
      // await milvus.dropCollection({ collection_name: 'memory_anchors' })

      // 重新创建集合
      await milvus.createCollection({
        collection_name: 'memory_anchors',
        dimension: 1536 // 向量维度
      })

      // 恢复数据
      if (memoryAnchors.length > 0) {
        await milvus.insert({
          collection_name: 'memory_anchors',
          data: memoryAnchors
        })
      }
    } catch (error) {
      console.error('恢复 Milvus 集合失败:', error)
      throw error
    }
  }

  private async cleanOldBackups() {
    const backups = fs
      .readdirSync(this.backupDir)
      .filter((name) => name.startsWith('backup_'))
      .sort()
      .reverse()

    // 删除超出最大数量限制的旧备份
    for (let i = this.MAX_BACKUPS; i < backups.length; i++) {
      const backupPath = path.join(this.backupDir, backups[i])
      fs.rmSync(backupPath, { recursive: true })
    }
  }

  // 获取所有备份的列表
  listBackups(): Array<{
    name: string
    timestamp: string
    note: string
  }> {
    return fs
      .readdirSync(this.backupDir)
      .filter((name) => name.startsWith('backup_'))
      .map((name) => {
        const infoPath = path.join(this.backupDir, name, 'backup-info.json')
        const info = JSON.parse(fs.readFileSync(infoPath, 'utf-8'))
        return {
          name,
          timestamp: info.timestamp,
          note: info.note
        }
      })
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
  }
}

// 导出单例实例
export const backupManager = new DatabaseBackupManager()
