import { EventEmitter } from 'events'
import { MemoryAnchor } from '../db/types'

interface StrengthAdjustment {
  sourceId: string
  targetId: string
  oldStrength: number
  newStrength: number
  reason: string
  timestamp: Date
}

interface AdjusterConfig {
  minStrength: number // 最小关联强度
  maxStrength: number // 最大关联强度
  decayRate: number // 强度衰减率
  strengthenRate: number // 强度增强率
  autoAdjust: boolean // 是否自动调整
}

interface AdjustmentHistory {
  adjustments: StrengthAdjustment[]
  timestamp: Date
  userId: string
}

export class MemoryStrengthAdjuster extends EventEmitter {
  private static instance: MemoryStrengthAdjuster
  private config: AdjusterConfig
  private history: AdjustmentHistory[] = []
  private strengthMap: Map<string, Map<string, number>> = new Map()

  private constructor() {
    super()
    this.config = {
      minStrength: 0,
      maxStrength: 1,
      decayRate: 0.1,
      strengthenRate: 0.2,
      autoAdjust: true
    }
  }

  static getInstance(): MemoryStrengthAdjuster {
    if (!MemoryStrengthAdjuster.instance) {
      MemoryStrengthAdjuster.instance = new MemoryStrengthAdjuster()
    }
    return MemoryStrengthAdjuster.instance
  }

  // 设置记忆关联强度
  setStrength(sourceId: string, targetId: string, strength: number, reason: string): void {
    const oldStrength = this.getStrength(sourceId, targetId)
    strength = this.clampStrength(strength)

    if (!this.strengthMap.has(sourceId)) {
      this.strengthMap.set(sourceId, new Map())
    }
    this.strengthMap.get(sourceId)!.set(targetId, strength)

    const adjustment: StrengthAdjustment = {
      sourceId,
      targetId,
      oldStrength,
      newStrength: strength,
      reason,
      timestamp: new Date()
    }

    this.recordAdjustment(adjustment)
    this.emit('strength_adjusted', adjustment)
  }

  // 获取记忆关联强度
  getStrength(sourceId: string, targetId: string): number {
    return this.strengthMap.get(sourceId)?.get(targetId) || 0
  }

  // 增强记忆关联
  strengthen(sourceId: string, targetId: string, factor: number = 1): void {
    const currentStrength = this.getStrength(sourceId, targetId)
    const increase = this.config.strengthenRate * factor
    const newStrength = this.clampStrength(currentStrength + increase)

    this.setStrength(sourceId, targetId, newStrength, '记忆关联增强')
  }

  // 减弱记忆关联
  weaken(sourceId: string, targetId: string, factor: number = 1): void {
    const currentStrength = this.getStrength(sourceId, targetId)
    const decrease = this.config.decayRate * factor
    const newStrength = this.clampStrength(currentStrength - decrease)

    this.setStrength(sourceId, targetId, newStrength, '记忆关联减弱')
  }

  // 批量调整关联强度
  batchAdjust(adjustments: Array<{
    sourceId: string
    targetId: string
    strength: number
    reason: string
  }>): void {
    adjustments.forEach(adj => {
      this.setStrength(adj.sourceId, adj.targetId, adj.strength, adj.reason)
    })
  }

  // 获取与指定记忆相关的所有关联
  getRelatedMemories(memoryId: string): Array<{
    targetId: string
    strength: number
  }> {
    const related: Array<{ targetId: string; strength: number }> = []
    
    // 作为源的关联
    this.strengthMap.get(memoryId)?.forEach((strength, targetId) => {
      related.push({ targetId, strength })
    })

    // 作为目标的关联
    this.strengthMap.forEach((targets, sourceId) => {
      if (sourceId !== memoryId && targets.has(memoryId)) {
        related.push({
          targetId: sourceId,
          strength: targets.get(memoryId)!
        })
      }
    })

    return related
  }

  // 自动调整记忆关联强度
  private autoAdjustStrengths(): void {
    if (!this.config.autoAdjust) return

    this.strengthMap.forEach((targets, sourceId) => {
      targets.forEach((strength, targetId) => {
        // 根据时间衰减
        const decayedStrength = this.calculateDecay(strength)
        if (decayedStrength !== strength) {
          this.setStrength(sourceId, targetId, decayedStrength, '自动时间衰减')
        }
      })
    })
  }

  // 计算强度衰减
  private calculateDecay(strength: number): number {
    // 简单的线性衰减
    return this.clampStrength(strength - this.config.decayRate)
  }

  // 限制强度范围
  private clampStrength(strength: number): number {
    return Math.max(this.config.minStrength, Math.min(this.config.maxStrength, strength))
  }

  // 记录调整历史
  private recordAdjustment(adjustment: StrengthAdjustment): void {
    const historyEntry: AdjustmentHistory = {
      adjustments: [adjustment],
      timestamp: new Date(),
      userId: 'system' // TODO: 集成用户系统
    }
    this.history.push(historyEntry)
  }

  // 获取调整历史
  getHistory(): AdjustmentHistory[] {
    return this.history
  }

  // 清除历史记录
  clearHistory(): void {
    this.history = []
    this.emit('history_cleared')
  }

  // 更新配置
  setConfig(config: Partial<AdjusterConfig>): void {
    this.config = { ...this.config, ...config }
    this.emit('config_updated', this.config)
  }

  // 获取当前配置
  getConfig(): AdjusterConfig {
    return this.config
  }

  // 导出关联数据
  exportStrengthMap(): Record<string, Record<string, number>> {
    const exported: Record<string, Record<string, number>> = {}
    
    this.strengthMap.forEach((targets, sourceId) => {
      exported[sourceId] = {}
      targets.forEach((strength, targetId) => {
        exported[sourceId][targetId] = strength
      })
    })

    return exported
  }

  // 导入关联数据
  importStrengthMap(data: Record<string, Record<string, number>>): void {
    this.strengthMap.clear()
    
    Object.entries(data).forEach(([sourceId, targets]) => {
      const targetMap = new Map<string, number>()
      Object.entries(targets).forEach(([targetId, strength]) => {
        targetMap.set(targetId, this.clampStrength(strength))
      })
      this.strengthMap.set(sourceId, targetMap)
    })

    this.emit('data_imported')
  }
}

// 导出单例实例
export const memoryStrengthAdjuster = MemoryStrengthAdjuster.getInstance() 