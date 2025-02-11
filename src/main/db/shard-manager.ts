import { PrismaClient } from '@prisma/client'

import { errorHandler } from './error-handler'
import { performanceMonitor } from './performance-monitor'
import { withTransaction } from './prisma'

interface ShardConfig {
  shardKey: string
  shardCount: number
  shardingStrategy: 'hash' | 'range'
  replicationFactor: number
}

interface ShardInfo {
  id: string
  range: {
    min: number
    max: number
  }
  nodeId: string
  status: 'active' | 'rebalancing' | 'inactive'
  metrics: {
    size: number
    operations: number
    lastAccess: Date
  }
}

export class ShardManager {
  private static instance: ShardManager
  private shardConfigs: Map<string, ShardConfig> = new Map()
  private shardInfo: Map<string, ShardInfo[]> = new Map()
  private readonly DEFAULT_SHARD_COUNT = 4
  private readonly DEFAULT_REPLICATION_FACTOR = 2

  private constructor() {
    this.initializeShardConfigs()
  }

  static getInstance(): ShardManager {
    if (!ShardManager.instance) {
      ShardManager.instance = new ShardManager()
    }
    return ShardManager.instance
  }

  private initializeShardConfigs() {
    // 为不同的数据类型配置分片策略
    this.shardConfigs.set('novel', {
      shardKey: 'id',
      shardCount: this.DEFAULT_SHARD_COUNT,
      shardingStrategy: 'hash',
      replicationFactor: this.DEFAULT_REPLICATION_FACTOR
    })

    this.shardConfigs.set('chapter', {
      shardKey: 'novelId',
      shardCount: this.DEFAULT_SHARD_COUNT,
      shardingStrategy: 'hash',
      replicationFactor: this.DEFAULT_REPLICATION_FACTOR
    })

    this.shardConfigs.set('memoryAnchor', {
      shardKey: 'chapterId',
      shardCount: this.DEFAULT_SHARD_COUNT,
      shardingStrategy: 'hash',
      replicationFactor: this.DEFAULT_REPLICATION_FACTOR
    })
  }

  async getShardForKey(modelName: string, key: string | number): Promise<string> {
    const config = this.shardConfigs.get(modelName)
    if (!config) {
      throw new Error(`未找到模型 ${modelName} 的分片配置`)
    }

    const shardId = this.calculateShardId(key, config)
    const shards = this.shardInfo.get(modelName) || []
    const shard = shards.find((s) => s.id === shardId)

    if (!shard || shard.status !== 'active') {
      await this.rebalanceShards(modelName)
      throw new Error(`分片 ${shardId} 不可用`)
    }

    return shard.nodeId
  }

  private calculateShardId(key: string | number, config: ShardConfig): string {
    if (config.shardingStrategy === 'hash') {
      const hash = this.hashKey(key.toString())
      return `shard-${hash % config.shardCount}`
    } else {
      // 范围分片策略的实现
      const numKey = typeof key === 'string' ? parseInt(key) : key
      const rangeSize = Number.MAX_SAFE_INTEGER / config.shardCount
      const shardIndex = Math.floor(numKey / rangeSize)
      return `shard-${shardIndex}`
    }
  }

  private hashKey(key: string): number {
    let hash = 0
    for (let i = 0; i < key.length; i++) {
      const char = key.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash = hash & hash // Convert to 32-bit integer
    }
    return Math.abs(hash)
  }

  async rebalanceShards(modelName: string): Promise<void> {
    const config = this.shardConfigs.get(modelName)
    if (!config) return

    const monitor = performanceMonitor.startOperation('rebalanceShards')
    try {
      await withTransaction(async (tx) => {
        const shards = this.shardInfo.get(modelName) || []

        // 计算负载情况
        const loads = shards.map((shard) => ({
          id: shard.id,
          load: shard.metrics.operations / shard.metrics.size
        }))

        // 找出负载不均衡的分片
        const avgLoad = loads.reduce((sum, item) => sum + item.load, 0) / loads.length
        const overloadedShards = loads.filter((item) => item.load > avgLoad * 1.2)
        const underloadedShards = loads.filter((item) => item.load < avgLoad * 0.8)

        // 执行再平衡
        for (const overloaded of overloadedShards) {
          if (underloadedShards.length === 0) break

          const target = underloadedShards.shift()
          if (!target) break

          await this.migrateShard(modelName, overloaded.id, target.id, tx)
        }
      })
    } catch (error) {
      errorHandler.handleError(error, {
        context: 'ShardManager.rebalanceShards',
        modelName
      })
      throw error
    } finally {
      monitor()
    }
  }

  private async migrateShard(modelName: string, sourceId: string, targetId: string, tx: PrismaClient): Promise<void> {
    const monitor = performanceMonitor.startOperation('migrateShard')
    try {
      // 更新分片状态
      const sourceShards = this.shardInfo.get(modelName) || []
      const sourceShard = sourceShards.find((s) => s.id === sourceId)
      const targetShard = sourceShards.find((s) => s.id === targetId)

      if (!sourceShard || !targetShard) {
        throw new Error('分片不存在')
      }

      sourceShard.status = 'rebalancing'
      targetShard.status = 'rebalancing'

      // 执行数据迁移
      const batchSize = 1000
      let migrated = 0

      while (true) {
        const records = await tx[modelName].findMany({
          where: {
            _shard: sourceId
          },
          take: batchSize,
          skip: migrated
        })

        if (records.length === 0) break

        await tx[modelName].createMany({
          data: records.map((record) => ({
            ...record,
            _shard: targetId
          }))
        })

        migrated += records.length
      }

      // 更新分片状态和指标
      sourceShard.metrics.size -= migrated
      targetShard.metrics.size += migrated
      sourceShard.status = 'active'
      targetShard.status = 'active'
    } catch (error) {
      errorHandler.handleError(error, {
        context: 'ShardManager.migrateShard',
        modelName,
        sourceId,
        targetId
      })
      throw error
    } finally {
      monitor()
    }
  }

  async updateShardMetrics(modelName: string, shardId: string, metrics: Partial<ShardInfo['metrics']>): Promise<void> {
    const shards = this.shardInfo.get(modelName) || []
    const shard = shards.find((s) => s.id === shardId)

    if (shard) {
      shard.metrics = {
        ...shard.metrics,
        ...metrics,
        lastAccess: new Date()
      }
    }
  }

  getShardConfig(modelName: string): ShardConfig | undefined {
    return this.shardConfigs.get(modelName)
  }

  getShardInfo(modelName: string): ShardInfo[] | undefined {
    return this.shardInfo.get(modelName)
  }
}
