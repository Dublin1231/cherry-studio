// Prisma 生成的类型
import type { Prisma } from '@prisma/client'
import { EventEmitter } from 'events'
import { v4 as uuidv4 } from 'uuid'

import { MLPredictor } from './ml-predictor'
import { prisma } from './prisma'
import type { Foreshadowing, ForeshadowingInput, ForeshadowingUpdate, MLPrediction } from './types'
type ForeshadowingCreateInput = Prisma.ForeshadowingCreateInput
type ForeshadowingUpdateInput = Prisma.ForeshadowingUpdateInput

export interface Foreshadowing {
  id: string
  novelId: string
  content: string
  plantedAt: number
  expectedAt: number
  status: 'planted' | 'recalled'
  createdAt: Date
  updatedAt: Date
}

export interface ForeshadowingInput {
  novelId: string
  content: string
  plantedAt: number
  expectedAt: number
}

export interface ForeshadowingUpdate {
  status?: 'planted' | 'recalled'
}

interface ForeshadowingAnalysis {
  totalCount: number
  activeCount: number
  resolvedCount: number
  abandonedCount: number
  byType: Record<Foreshadowing['type'], number>
  byImportance: Record<Foreshadowing['importance'], number>
  averageResolutionTime: number
  suggestions: string[]
}

export class ForeshadowingManager extends EventEmitter {
  private mlPredictor: MLPredictor

  constructor(mlPredictor: MLPredictor) {
    super()
    this.mlPredictor = mlPredictor
  }

  async createForeshadowing(input: ForeshadowingInput): Promise<Foreshadowing> {
    const now = new Date()

    // 使用ML预测器预测重要性
    const predictions = await this.mlPredictor.predict({
      description: input.content,
      setupContext: `Chapter ${input.plantedAt}`
    })

    const prediction = predictions[0]

    const createInput: Prisma.ForeshadowingCreateInput = {
      id: uuidv4(),
      novelId: input.novelId,
      content: input.content,
      plantedAt: input.plantedAt,
      expectedAt: input.expectedAt,
      status: 'planted',
      createdAt: now,
      updatedAt: now
    }

    const foreshadowing = await prisma.foreshadowing.create({
      data: createInput
    })

    this.emit('foreshadowing:created', foreshadowing)
    return foreshadowing as unknown as Foreshadowing
  }

  async updateForeshadowing(id: string, update: ForeshadowingUpdate): Promise<Foreshadowing> {
    const updateInput: Prisma.ForeshadowingUpdateInput = {
      ...update,
      updatedAt: new Date()
    }

    const foreshadowing = await prisma.foreshadowing.update({
      where: { id },
      data: updateInput
    })

    this.emit('foreshadowing:updated', foreshadowing)
    return foreshadowing as unknown as Foreshadowing
  }

  async getForeshadowing(id: string): Promise<Foreshadowing | null> {
    const foreshadowing = await prisma.foreshadowing.findUnique({
      where: { id }
    })
    return foreshadowing as unknown as Foreshadowing | null
  }

  async getNovelForeshadowings(novelId: string): Promise<Foreshadowing[]> {
    const foreshadowings = await prisma.foreshadowing.findMany({
      where: { novelId }
    })
    return foreshadowings as unknown as Foreshadowing[]
  }

  async recallForeshadowing(id: string): Promise<Foreshadowing> {
    return this.updateForeshadowing(id, {
      status: 'recalled'
    })
  }

  async checkForeshadowingHealth(novelId: string): Promise<MLPrediction[]> {
    const foreshadowings = await this.getNovelForeshadowings(novelId)

    const longPendingForeshadowings = foreshadowings.filter((f) => {
      const daysPending = (Date.now() - f.createdAt.getTime()) / (1000 * 60 * 60 * 24)
      return f.status !== 'recalled' && daysPending > 30
    })

    return longPendingForeshadowings.map((f) => ({
      type: 'long_pending_foreshadowing',
      details: `伏笔"${f.content}"已超过30天未解决`,
      severity: 'medium',
      confidence: 0.9,
      suggestion: '考虑在近期章节中解决该伏笔或将其标记为已回收',
      metadata: {
        foreshadowingId: f.id,
        daysPending: (Date.now() - f.createdAt.getTime()) / (1000 * 60 * 60 * 24)
      }
    }))
  }

  async analyzeForeshadowings(novelId: string): Promise<{
    totalCount: number
    activeCount: number
    resolvedCount: number
    abandonedCount: number
  }> {
    const foreshadowings = await this.getNovelForeshadowings(novelId)

    return {
      totalCount: foreshadowings.length,
      activeCount: foreshadowings.filter((f) => f.status === 'planted').length,
      resolvedCount: foreshadowings.filter((f) => f.status === 'recalled').length,
      abandonedCount: 0 // 在当前schema中没有abandoned状态
    }
  }
}

// 导出单例实例
export const foreshadowingManager = new ForeshadowingManager(new MLPredictor())
