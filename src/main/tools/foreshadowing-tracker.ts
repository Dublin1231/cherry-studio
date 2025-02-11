import { EventEmitter } from 'events'
import { Foreshadowing } from '../db/types'

interface TrackingStats {
  totalCount: number
  resolvedCount: number
  pendingCount: number
  overdueCount: number
  resolutionRate: number
  averageResolutionTime: number
}

interface TrackingConfig {
  overdueThreshold: number // 超期阈值(天)
  warningThreshold: number // 警告阈值(天)
  checkInterval: number // 检查间隔(毫秒)
  autoReminder: boolean // 是否自动提醒
}

interface TrackingEvent {
  type: 'resolved' | 'overdue' | 'warning'
  foreshadowingId: string
  timestamp: Date
  details: string
}

export class ForeshadowingTracker extends EventEmitter {
  private static instance: ForeshadowingTracker
  private config: TrackingConfig
  private trackingData: Map<string, {
    foreshadowing: Foreshadowing
    events: TrackingEvent[]
  }> = new Map()
  private checkTimer: NodeJS.Timeout | null = null

  private constructor() {
    super()
    this.config = {
      overdueThreshold: 30, // 30天
      warningThreshold: 20, // 20天
      checkInterval: 24 * 60 * 60 * 1000, // 1天
      autoReminder: true
    }
  }

  static getInstance(): ForeshadowingTracker {
    if (!ForeshadowingTracker.instance) {
      ForeshadowingTracker.instance = new ForeshadowingTracker()
    }
    return ForeshadowingTracker.instance
  }

  // 开始追踪伏笔
  startTracking(foreshadowing: Foreshadowing): void {
    this.trackingData.set(foreshadowing.id, {
      foreshadowing,
      events: []
    })
    
    if (this.config.autoReminder && !this.checkTimer) {
      this.startPeriodicCheck()
    }
  }

  // 更新伏笔状态
  updateStatus(id: string, status: 'resolved' | 'active'): void {
    const tracking = this.trackingData.get(id)
    if (!tracking) return

    if (status === 'resolved') {
      const event: TrackingEvent = {
        type: 'resolved',
        foreshadowingId: id,
        timestamp: new Date(),
        details: '伏笔已解决'
      }
      tracking.events.push(event)
      this.emit('foreshadowing_resolved', { id, event })
    }

    tracking.foreshadowing.status = status
  }

  // 获取追踪统计数据
  getStats(): TrackingStats {
    let resolvedCount = 0
    let totalTime = 0
    const now = new Date()

    this.trackingData.forEach((data) => {
      if (data.foreshadowing.status === 'resolved') {
        resolvedCount++
        const resolvedEvent = data.events.find((e) => e.type === 'resolved')
        if (resolvedEvent) {
          totalTime += resolvedEvent.timestamp.getTime() - new Date(data.foreshadowing.createdAt).getTime()
        }
      }
    })

    const totalCount = this.trackingData.size
    const averageResolutionTime = resolvedCount > 0 ? totalTime / resolvedCount : 0

    return {
      totalCount,
      resolvedCount,
      pendingCount: totalCount - resolvedCount,
      overdueCount: this.getOverdueForeshadowings().length,
      resolutionRate: totalCount > 0 ? resolvedCount / totalCount : 0,
      averageResolutionTime
    }
  }

  // 获取超期伏笔
  getOverdueForeshadowings(): Foreshadowing[] {
    const now = new Date()
    const overdue: Foreshadowing[] = []

    this.trackingData.forEach((data) => {
      if (data.foreshadowing.status !== 'resolved') {
        const age = (now.getTime() - new Date(data.foreshadowing.createdAt).getTime()) / (1000 * 60 * 60 * 24)
        if (age > this.config.overdueThreshold) {
          overdue.push(data.foreshadowing)
        }
      }
    })

    return overdue
  }

  // 获取需要警告的伏笔
  getWarningForeshadowings(): Foreshadowing[] {
    const now = new Date()
    const warnings: Foreshadowing[] = []

    this.trackingData.forEach((data) => {
      if (data.foreshadowing.status !== 'resolved') {
        const age = (now.getTime() - new Date(data.foreshadowing.createdAt).getTime()) / (1000 * 60 * 60 * 24)
        if (age > this.config.warningThreshold && age <= this.config.overdueThreshold) {
          warnings.push(data.foreshadowing)
        }
      }
    })

    return warnings
  }

  // 开始定期检查
  private startPeriodicCheck(): void {
    if (this.checkTimer) return

    this.checkTimer = setInterval(() => {
      this.checkForeshadowings()
    }, this.config.checkInterval)
  }

  // 检查伏笔状态
  private checkForeshadowings(): void {
    const now = new Date()

    this.trackingData.forEach((data, id) => {
      if (data.foreshadowing.status !== 'resolved') {
        const age = (now.getTime() - new Date(data.foreshadowing.createdAt).getTime()) / (1000 * 60 * 60 * 24)

        // 检查是否超期
        if (age > this.config.overdueThreshold) {
          const event: TrackingEvent = {
            type: 'overdue',
            foreshadowingId: id,
            timestamp: now,
            details: `伏笔已超过${this.config.overdueThreshold}天未解决`
          }
          data.events.push(event)
          this.emit('foreshadowing_overdue', { id, event })
        }
        // 检查是否需要警告
        else if (age > this.config.warningThreshold) {
          const event: TrackingEvent = {
            type: 'warning',
            foreshadowingId: id,
            timestamp: now,
            details: `伏笔即将超期,已持续${Math.floor(age)}天`
          }
          data.events.push(event)
          this.emit('foreshadowing_warning', { id, event })
        }
      }
    })
  }

  // 更新配置
  setConfig(config: Partial<TrackingConfig>): void {
    this.config = { ...this.config, ...config }
    
    // 如果更改了检查间隔,重新启动定时器
    if (config.checkInterval && this.checkTimer) {
      clearInterval(this.checkTimer)
      this.checkTimer = null
      if (this.config.autoReminder) {
        this.startPeriodicCheck()
      }
    }
  }

  // 获取伏笔事件历史
  getEventHistory(id: string): TrackingEvent[] {
    return this.trackingData.get(id)?.events || []
  }

  // 停止追踪
  stopTracking(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer)
      this.checkTimer = null
    }
  }

  // 获取当前配置
  getConfig(): TrackingConfig {
    return this.config
  }
}

// 导出单例实例
export const foreshadowingTracker = ForeshadowingTracker.getInstance() 