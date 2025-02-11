import { errorHandler } from './error-handler'
import { performanceMonitor } from './performance-monitor'
import { ShardManager } from './shard-manager'

interface ShardMetrics {
  operationsPerSecond: number
  averageResponseTime: number
  errorRate: number
  diskUsage: number
  connectionCount: number
  replicationLag?: number
}

interface ShardAlert {
  shardId: string
  type: 'high_load' | 'high_error_rate' | 'replication_lag' | 'disk_space'
  severity: 'warning' | 'critical'
  message: string
  timestamp: Date
  metrics: Partial<ShardMetrics>
}

export class ShardMonitor {
  private static instance: ShardMonitor
  private alerts: ShardAlert[] = []
  private readonly METRICS_INTERVAL = 60 * 1000 // 1分钟
  private readonly CLEANUP_INTERVAL = 24 * 60 * 60 * 1000 // 1天

  private constructor(private shardManager: ShardManager) {
    this.startMonitoring()
  }

  static getInstance(shardManager: ShardManager): ShardMonitor {
    if (!ShardMonitor.instance) {
      ShardMonitor.instance = new ShardMonitor(shardManager)
    }
    return ShardMonitor.instance
  }

  private startMonitoring() {
    // 定期收集指标
    setInterval(() => {
      this.collectMetrics()
    }, this.METRICS_INTERVAL)

    // 定期清理旧数据
    setInterval(() => {
      this.cleanupOldData()
    }, this.CLEANUP_INTERVAL)
  }

  private async collectMetrics() {
    const monitor = performanceMonitor.startOperation('collectShardMetrics')
    try {
      for (const modelName of ['novel', 'chapter', 'memoryAnchor']) {
        const shards = this.shardManager.getShardInfo(modelName)
        if (!shards) continue

        for (const shard of shards) {
          const metrics = await this.getShardMetrics(modelName, shard.id)

          // 更新分片指标
          this.shardManager.updateShardMetrics(modelName, shard.id, {
            operations: metrics.operationsPerSecond,
            size: Math.round(metrics.diskUsage / 1024 / 1024) // 转换为MB
          })

          // 检查告警条件
          this.checkAlertConditions(modelName, shard.id, metrics)
        }
      }
    } catch (error) {
      if (error instanceof Error) {
        errorHandler.handleError(error, {
          context: 'ShardMonitor.collectMetrics'
        })
      }
    } finally {
      monitor()
    }
  }

  private async getShardMetrics(_modelName: string, _shardId: string): Promise<ShardMetrics> {
    const monitor = performanceMonitor.startOperation('getShardMetrics')
    try {
      // 这里应该实现实际的指标收集逻辑
      // 目前返回模拟数据
      return {
        operationsPerSecond: Math.random() * 100,
        averageResponseTime: Math.random() * 50,
        errorRate: Math.random() * 0.01,
        diskUsage: Math.random() * 1024 * 1024 * 1024, // 随机 1GB 以内
        connectionCount: Math.floor(Math.random() * 100),
        replicationLag: Math.random() * 1000
      }
    } finally {
      monitor()
    }
  }

  private checkAlertConditions(_modelName: string, shardId: string, metrics: ShardMetrics) {
    const timestamp = new Date()

    // 检查高负载
    if (metrics.operationsPerSecond > 90) {
      this.addAlert({
        shardId,
        type: 'high_load',
        severity: metrics.operationsPerSecond > 95 ? 'critical' : 'warning',
        message: `分片 ${shardId} 负载过高: ${metrics.operationsPerSecond} ops/s`,
        timestamp,
        metrics: {
          operationsPerSecond: metrics.operationsPerSecond,
          averageResponseTime: metrics.averageResponseTime
        }
      })
    }

    // 检查错误率
    if (metrics.errorRate > 0.01) {
      this.addAlert({
        shardId,
        type: 'high_error_rate',
        severity: metrics.errorRate > 0.05 ? 'critical' : 'warning',
        message: `分片 ${shardId} 错误率过高: ${(metrics.errorRate * 100).toFixed(2)}%`,
        timestamp,
        metrics: {
          errorRate: metrics.errorRate
        }
      })
    }

    // 检查复制延迟
    if (metrics.replicationLag && metrics.replicationLag > 500) {
      this.addAlert({
        shardId,
        type: 'replication_lag',
        severity: metrics.replicationLag > 1000 ? 'critical' : 'warning',
        message: `分片 ${shardId} 复制延迟过高: ${metrics.replicationLag}ms`,
        timestamp,
        metrics: {
          replicationLag: metrics.replicationLag
        }
      })
    }

    // 检查磁盘空间
    const diskUsageGB = metrics.diskUsage / 1024 / 1024 / 1024
    if (diskUsageGB > 0.8) {
      this.addAlert({
        shardId,
        type: 'disk_space',
        severity: diskUsageGB > 0.9 ? 'critical' : 'warning',
        message: `分片 ${shardId} 磁盘使用率过高: ${(diskUsageGB * 100).toFixed(2)}%`,
        timestamp,
        metrics: {
          diskUsage: metrics.diskUsage
        }
      })
    }
  }

  private addAlert(alert: ShardAlert) {
    this.alerts.push(alert)

    // 如果是严重告警，可以触发自动处理
    if (alert.severity === 'critical') {
      this.handleCriticalAlert(alert)
    }
  }

  private async handleCriticalAlert(alert: ShardAlert) {
    const monitor = performanceMonitor.startOperation('handleCriticalAlert')
    try {
      switch (alert.type) {
        case 'high_load':
          // 触发负载均衡
          await this.shardManager.rebalanceShards('novel')
          await this.shardManager.rebalanceShards('chapter')
          await this.shardManager.rebalanceShards('memoryAnchor')
          break

        case 'disk_space':
          // TODO: 实现数据归档或清理策略
          break

        case 'replication_lag':
          // TODO: 实现复制追赶策略
          break
      }
    } catch (error) {
      if (error instanceof Error) {
        errorHandler.handleError(error, {
          context: 'ShardMonitor.handleCriticalAlert',
          alert
        })
      }
    } finally {
      monitor()
    }
  }

  private cleanupOldData() {
    const now = Date.now()
    const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000
    this.alerts = this.alerts.filter((alert) => alert.timestamp.getTime() > oneWeekAgo)
  }

  getAlerts(options?: {
    type?: ShardAlert['type']
    severity?: ShardAlert['severity']
    from?: Date
    to?: Date
  }): ShardAlert[] {
    let filtered = this.alerts

    if (options?.type) {
      filtered = filtered.filter((alert) => alert.type === options.type)
    }

    if (options?.severity) {
      filtered = filtered.filter((alert) => alert.severity === options.severity)
    }

    if (options?.from) {
      filtered = filtered.filter((alert) => alert.timestamp >= options.from!)
    }

    if (options?.to) {
      filtered = filtered.filter((alert) => alert.timestamp <= options.to!)
    }

    return filtered.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
  }
}
