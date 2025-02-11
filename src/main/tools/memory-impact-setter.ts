import { EventEmitter } from 'events'
import { PrismaClient } from '@prisma/client'
import type { MemoryAnchor } from '../db/types'

/**
 * MemoryImpactSetter - 记忆影响范围设置器
 * 
 * 该组件负责管理记忆锚点的影响范围和传播规则,包括:
 * 1. 时间范围设置 - 控制记忆对前后文章节的影响范围
 * 2. 衰减规则 - 定义影响强度如何随距离衰减
 * 3. 传播规则 - 管理影响如何通过记忆关联网络传播
 * 4. 优先级管理 - 设置不同类型影响的权重
 * 
 * 主要功能:
 * - setImpactRange: 设置记忆的影响范围
 * - calculatePropagation: 计算影响的传播
 * - setDecayRules: 配置衰减规则
 * - setPropagationRules: 配置传播规则
 * 
 * 使用示例:
 * ```typescript
 * const impactSetter = MemoryImpactSetter.getInstance()
 * 
 * // 设置影响范围
 * const range = await impactSetter.setImpactRange('memory-1', {
 *   before: 3,
 *   after: 5
 * })
 * 
 * // 计算影响传播
 * const analysis = await impactSetter.calculatePropagation('memory-1')
 * ```
 * 
 * 事件:
 * - impact:set - 当设置新的影响范围时触发
 * - impact:analyzed - 当完成影响分析时触发
 * - config:updated - 当更新配置时触发
 * 
 * @class MemoryImpactSetter
 * @extends EventEmitter
 */

// 影响范围配置接口
export interface ImpactConfig {
  // 时间范围设置
  timeRange: {
    before: number  // 影响前文的章节数
    after: number   // 影响后文的章节数
  }
  // 衰减规则
  decayRules: {
    mode: 'linear' | 'exponential' | 'custom'
    rate: number    // 衰减率
    minStrength: number  // 最小影响强度
  }
  // 传播设置
  propagation: {
    maxDepth: number     // 最大传播深度
    threshold: number    // 传播阈值
    allowCycles: boolean // 是否允许循环传播
  }
  // 优先级设置
  priority: {
    levels: ('critical' | 'high' | 'medium' | 'low')[]
    weights: Record<string, number>
  }
}

// 影响范围数据接口
export interface ImpactRange {
  memoryId: string
  affectedChapters: Array<{
    chapterId: string
    strength: number
    priority: string
  }>
  propagationPath: Array<{
    fromId: string
    toId: string
    strength: number
  }>
}

// 影响分析结果接口
export interface ImpactAnalysis {
  directImpact: number      // 直接影响强度
  propagatedImpact: number  // 传播后的影响强度
  coverage: {
    chapters: string[]      // 受影响的章节
    memories: string[]      // 受影响的记忆锚点
  }
  metrics: {
    averageStrength: number
    maxStrength: number
    propagationDepth: number
  }
}

export class MemoryImpactSetter extends EventEmitter {
  private static instance: MemoryImpactSetter
  private prisma: PrismaClient
  private config: ImpactConfig
  private impactRanges: Map<string, ImpactRange> = new Map()

  private constructor() {
    super()
    this.prisma = new PrismaClient()
    this.config = {
      timeRange: {
        before: 5,
        after: 10
      },
      decayRules: {
        mode: 'exponential',
        rate: 0.8,
        minStrength: 0.1
      },
      propagation: {
        maxDepth: 3,
        threshold: 0.2,
        allowCycles: false
      },
      priority: {
        levels: ['critical', 'high', 'medium', 'low'],
        weights: {
          critical: 1.0,
          high: 0.8,
          medium: 0.5,
          low: 0.3
        }
      }
    }
  }

  static getInstance(): MemoryImpactSetter {
    if (!MemoryImpactSetter.instance) {
      MemoryImpactSetter.instance = new MemoryImpactSetter()
    }
    return MemoryImpactSetter.instance
  }

  // 设置影响范围
  async setImpactRange(
    memoryId: string,
    timeRange?: Partial<ImpactConfig['timeRange']>,
    priority?: string
  ): Promise<ImpactRange> {
    const memory = await this.prisma.memoryAnchor.findUnique({
      where: { id: memoryId },
      include: { chapter: true }
    })

    if (!memory) {
      throw new Error(`Memory anchor ${memoryId} not found`)
    }

    const currentChapter = memory.chapter?.number || 0
    const range: ImpactRange = {
      memoryId,
      affectedChapters: [],
      propagationPath: []
    }

    // 计算影响范围内的章节
    const chapters = await this.prisma.chapter.findMany({
      where: {
        novelId: memory.novelId,
        number: {
          gte: currentChapter - (timeRange?.before || this.config.timeRange.before),
          lte: currentChapter + (timeRange?.after || this.config.timeRange.after)
        }
      }
    })

    // 为每个受影响章节计算影响强度
    for (const chapter of chapters) {
      const distance = Math.abs(chapter.number - currentChapter)
      const strength = this.calculateDecay(distance)
      
      range.affectedChapters.push({
        chapterId: chapter.id,
        strength,
        priority: priority || 'medium'
      })
    }

    this.impactRanges.set(memoryId, range)
    this.emit('impact:set', range)
    return range
  }

  // 更新衰减规则
  setDecayRules(rules: Partial<ImpactConfig['decayRules']>): void {
    this.config.decayRules = { ...this.config.decayRules, ...rules }
    this.emit('config:updated', this.config)
  }

  // 设置传播规则
  setPropagationRules(rules: Partial<ImpactConfig['propagation']>): void {
    this.config.propagation = { ...this.config.propagation, ...rules }
    this.emit('config:updated', this.config)
  }

  // 计算影响传播
  async calculatePropagation(memoryId: string): Promise<ImpactAnalysis> {
    const range = this.impactRanges.get(memoryId)
    if (!range) {
      throw new Error(`No impact range set for memory ${memoryId}`)
    }

    const visited = new Set<string>()
    const propagationQueue = [{ id: memoryId, depth: 0, strength: 1 }]
    const analysis: ImpactAnalysis = {
      directImpact: this.calculateDirectImpact(range),
      propagatedImpact: 0,
      coverage: {
        chapters: range.affectedChapters.map(c => c.chapterId),
        memories: [memoryId]
      },
      metrics: {
        averageStrength: 0,
        maxStrength: 0,
        propagationDepth: 0
      }
    }

    // 广度优先搜索进行影响传播
    while (propagationQueue.length > 0) {
      const current = propagationQueue.shift()!
      if (!current || visited.has(current.id)) continue

      visited.add(current.id)
      analysis.metrics.propagationDepth = Math.max(analysis.metrics.propagationDepth, current.depth)

      // 获取相关记忆
      const relations = await this.prisma.memoryRelation.findMany({
        where: { sourceId: current.id }
      })

      for (const relation of relations) {
        if (current.depth >= this.config.propagation.maxDepth) continue
        
        const propagatedStrength = current.strength * relation.weight * this.config.decayRules.rate
        if (propagatedStrength < this.config.propagation.threshold) continue

        analysis.propagatedImpact += propagatedStrength
        analysis.coverage.memories.push(relation.targetId)
        
        if (!this.config.propagation.allowCycles && visited.has(relation.targetId)) continue

        propagationQueue.push({
          id: relation.targetId,
          depth: current.depth + 1,
          strength: propagatedStrength
        })
      }
    }

    // 计算最终指标
    const strengths = range.affectedChapters.map(c => c.strength)
    analysis.metrics.averageStrength = strengths.reduce((a, b) => a + b, 0) / strengths.length
    analysis.metrics.maxStrength = Math.max(...strengths)

    this.emit('impact:analyzed', analysis)
    return analysis
  }

  // 获取影响范围
  getImpactRange(memoryId: string): ImpactRange | undefined {
    return this.impactRanges.get(memoryId)
  }

  // 获取当前配置
  getConfig(): ImpactConfig {
    return { ...this.config }
  }

  // 私有方法: 计算衰减
  private calculateDecay(distance: number): number {
    const { mode, rate, minStrength } = this.config.decayRules
    let strength: number

    switch (mode) {
      case 'linear':
        strength = 1 - (rate * distance)
        break
      case 'exponential':
        strength = Math.pow(rate, distance)
        break
      case 'custom':
        // 可以添加自定义衰减函数
        strength = 1 / (1 + rate * distance)
        break
      default:
        strength = Math.pow(rate, distance)
    }

    return Math.max(strength, minStrength)
  }

  // 私有方法: 计算直接影响
  private calculateDirectImpact(range: ImpactRange): number {
    return range.affectedChapters.reduce((sum, chapter) => {
      const weight = this.config.priority.weights[chapter.priority] || 0.5
      return sum + (chapter.strength * weight)
    }, 0)
  }

  // 清理资源
  async disconnect(): Promise<void> {
    await this.prisma.$disconnect()
  }
} 