import { EventEmitter } from 'events'
import { PrismaClient, MemoryAnchor, Prisma } from '@prisma/client'
import type { MemoryAnchor as MemoryAnchorType } from '../db/types'
import { MemoryStrengthAdjuster } from './memory-strength-adjuster'
import { MemoryRetriever } from './memory-retriever'
import { MemoryOptimizer } from './memory-optimizer'
import { MemoryImpactSetter, ImpactConfig, ImpactRange, ImpactAnalysis } from './memory-impact-setter'

// 管理器配置接口
interface ManagerConfig {
  autoOptimize?: boolean
  autoAdjustStrengths?: boolean
  useCaching?: boolean
  maxCacheSize?: number
  impactTracking?: boolean
  autoPropagate?: boolean
}

// 管理器统计接口
interface ManagerStats {
  totalMemories: number
  totalStrengthAdjustments: number
  totalRetrievals: number
  totalOptimizations: number
  cacheHitRate: number
  lastUpdate: Date
  impactStats: {
    totalImpactSets: number
    totalPropagations: number
    averageImpactStrength: number
  }
}

export class MemoryManager extends EventEmitter {
  private prisma: PrismaClient
  private strengthAdjuster!: MemoryStrengthAdjuster
  private retriever!: MemoryRetriever
  private optimizer!: MemoryOptimizer
  private impactSetter!: MemoryImpactSetter
  private config: ManagerConfig
  private stats: ManagerStats
  private static instance: MemoryManager

  private constructor(config: Partial<ManagerConfig> = {}) {
    super()
    this.prisma = new PrismaClient()
    
    // 设置默认配置
    const defaultConfig: ManagerConfig = {
      autoOptimize: true,
      autoAdjustStrengths: true,
      useCaching: true,
      maxCacheSize: 1000,
      impactTracking: true,
      autoPropagate: true
    }
    
    this.config = { ...defaultConfig, ...config }
    
    this.stats = {
      totalMemories: 0,
      totalStrengthAdjustments: 0,
      totalRetrievals: 0,
      totalOptimizations: 0,
      cacheHitRate: 0,
      lastUpdate: new Date(),
      impactStats: {
        totalImpactSets: 0,
        totalPropagations: 0,
        averageImpactStrength: 0
      }
    }

    // 初始化组件
    this.initializeComponents()
  }

  private initializeComponents(): void {
    this.strengthAdjuster = MemoryStrengthAdjuster.getInstance()
    this.retriever = MemoryRetriever.getInstance()
    this.optimizer = MemoryOptimizer.getInstance()
    this.impactSetter = MemoryImpactSetter.getInstance()
  }

  // 创建记忆
  async createMemory(data: {
    content: string
    chapterId: string
    type: string
    novelId: string
    embedding?: Buffer
  }): Promise<MemoryAnchor> {
    try {
      const memory = await this.prisma.memoryAnchor.create({
        data: {
          ...data,
          weight: 1.0
        }
      })
      
      this.stats.totalMemories++
      this.emit('memoryCreated', memory)
      return memory
    } catch (error) {
      this.emit('error', error)
      throw error
    }
  }

  // 更新记忆
  async updateMemory(id: string, data: Prisma.MemoryAnchorUpdateInput): Promise<MemoryAnchor> {
    try {
      const memory = await this.prisma.memoryAnchor.update({
        where: { id },
        data
      })
      
      this.emit('memoryUpdated', memory)
      return memory
    } catch (error) {
      this.emit('error', error)
      throw error
    }
  }

  // 删除记忆
  async deleteMemory(id: string): Promise<void> {
    try {
      await this.prisma.memoryAnchor.delete({
        where: { id }
      })

      await this.updateStats()
      this.emit('memory_deleted', id)
    } catch (error) {
      this.emit('deletion_error', error)
      throw error
    }
  }

  // 检索记忆
  async retrieveMemories(query: string, options?: {
    limit?: number
    minRelevance?: number
    useEmbeddings?: boolean
  }): Promise<MemoryAnchor[]> {
    try {
      const result = await this.retriever.retrieveMemories(query, options)
      this.stats.totalRetrievals++
      return result.memories
    } catch (error) {
      this.emit('error', error)
      throw error
    }
  }

  // 获取相关记忆
  async getRelatedMemories(memoryId: string, limit?: number): Promise<MemoryAnchor[]> {
    try {
      const memories = await this.retriever.getRelatedMemories(memoryId, limit)
      this.stats.totalRetrievals++
      return memories
    } catch (error) {
      this.emit('error', error)
      throw error
    }
  }

  // 调整关联强度
  async adjustStrength(sourceId: string, targetId: string, strength: number, reason: string): Promise<void> {
    try {
      this.strengthAdjuster.setStrength(sourceId, targetId, strength, reason)
    } catch (error) {
      this.emit('adjustment_error', error)
      throw error
    }
  }

  // 优化记忆
  async optimizeMemories(): Promise<void> {
    try {
      await this.optimizer.optimizeMemories()
    } catch (error) {
      this.emit('optimization_error', error)
      throw error
    }
  }

  // 设置记忆影响范围
  public async setMemoryImpact(memoryId: string, config: Partial<ImpactConfig['timeRange']>): Promise<ImpactRange> {
    if (!this.config.impactTracking) {
      throw new Error('Impact tracking is disabled')
    }

    const impact = await this.impactSetter.setImpactRange(memoryId, config)
    this.stats.impactStats.totalImpactSets++

    if (this.config.autoPropagate) {
      await this.calculateImpactPropagation(memoryId)
    }

    this.emit('impactSet', { memoryId, impact })
    return impact
  }

  // 计算影响传播
  public async calculateImpactPropagation(memoryId: string): Promise<ImpactAnalysis> {
    return this.impactSetter.calculatePropagation(memoryId)
  }

  // 获取影响范围
  getMemoryImpact(memoryId: string): ImpactRange | undefined {
    return this.impactSetter.getImpactRange(memoryId)
  }

  // 配置影响范围设置
  setImpactConfig(config: Partial<ImpactConfig>): void {
    if (config.decayRules) {
      this.impactSetter.setDecayRules(config.decayRules)
    }
    if (config.propagation) {
      this.impactSetter.setPropagationRules(config.propagation)
    }
  }

  // 更新统计信息
  private async updateStats(): Promise<void> {
    try {
      const totalMemories = await this.prisma.memoryAnchor.count()

      this.stats = {
        ...this.stats,
        totalMemories,
        lastUpdate: new Date()
      }

      this.emit('statsUpdated', this.stats)
    } catch (error) {
      this.emit('error', error)
      throw error
    }
  }

  // 获取统计信息
  getStats(): ManagerStats {
    return this.stats
  }

  // 更新配置
  setConfig(config: Partial<ManagerConfig>): void {
    this.config = { ...this.config, ...config }

    // 更新组件配置
    if (config.useCaching !== undefined) {
      this.retriever.setConfig({ useCaching: config.useCaching })
    }

    if (config.autoOptimize !== undefined) {
      if (config.autoOptimize) {
        this.optimizer.startAutoOptimization()
      } else {
        this.optimizer.stopAutoOptimization()
      }
    }

    this.emit('config_updated', this.config)
  }

  // 获取配置
  getConfig(): ManagerConfig {
    return this.config
  }

  // 断开连接
  public async disconnect(): Promise<void> {
    await this.prisma.$disconnect()
  }

  // 获取单例实例
  public static getInstance(config?: Partial<ManagerConfig>): MemoryManager {
    if (!MemoryManager.instance) {
      MemoryManager.instance = new MemoryManager(config)
    }
    return MemoryManager.instance
  }
}

// 导出单例实例
export const memoryManager = MemoryManager.getInstance() 