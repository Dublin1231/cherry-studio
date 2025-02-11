import { beforeEach, describe, expect, jest, test } from '@jest/globals'
import { PrismaClient } from '@prisma/client'
import { MemoryImpactSetter } from '../../main/tools/memory-impact-setter'

// Mock Prisma
jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    memoryAnchor: {
      findUnique: jest.fn(),
      findMany: jest.fn()
    },
    chapter: {
      findMany: jest.fn()
    },
    memoryRelation: {
      findMany: jest.fn()
    },
    $disconnect: jest.fn()
  }))
}))

describe('MemoryImpactSetter', () => {
  let impactSetter: MemoryImpactSetter
  let mockPrisma: jest.Mocked<PrismaClient>

  beforeEach(() => {
    jest.clearAllMocks()
    impactSetter = MemoryImpactSetter.getInstance()
    mockPrisma = new PrismaClient() as jest.Mocked<PrismaClient>
  })

  describe('setImpactRange', () => {
    const mockMemory = {
      id: 'memory-1',
      novelId: 'novel-1',
      chapterId: 'chapter-1',
      chapter: { number: 5 }
    }

    const mockChapters = [
      { id: 'chapter-1', number: 3 },
      { id: 'chapter-2', number: 4 },
      { id: 'chapter-3', number: 5 },
      { id: 'chapter-4', number: 6 },
      { id: 'chapter-5', number: 7 }
    ]

    test('应该正确设置影响范围', async () => {
      ;(mockPrisma.memoryAnchor.findUnique as jest.Mock).mockResolvedValue(mockMemory)
      ;(mockPrisma.chapter.findMany as jest.Mock).mockResolvedValue(mockChapters)

      const range = await impactSetter.setImpactRange('memory-1')

      expect(range.memoryId).toBe('memory-1')
      expect(range.affectedChapters.length).toBe(5)
      expect(range.affectedChapters[0].strength).toBeGreaterThan(0)
    })

    test('应该使用自定义时间范围', async () => {
      ;(mockPrisma.memoryAnchor.findUnique as jest.Mock).mockResolvedValue(mockMemory)
      ;(mockPrisma.chapter.findMany as jest.Mock).mockResolvedValue(mockChapters)

      const range = await impactSetter.setImpactRange('memory-1', { before: 2, after: 2 })

      expect(range.affectedChapters.length).toBe(5)
    })

    test('应该处理记忆锚点不存在的情况', async () => {
      ;(mockPrisma.memoryAnchor.findUnique as jest.Mock).mockResolvedValue(null)

      await expect(impactSetter.setImpactRange('invalid-id')).rejects.toThrow()
    })
  })

  describe('calculatePropagation', () => {
    const mockRelations = [
      { sourceId: 'memory-1', targetId: 'memory-2', weight: 0.8 },
      { sourceId: 'memory-2', targetId: 'memory-3', weight: 0.6 }
    ]

    test('应该正确计算影响传播', async () => {
      const mockRange = {
        memoryId: 'memory-1',
        affectedChapters: [
          { chapterId: 'chapter-1', strength: 0.8, priority: 'high' }
        ],
        propagationPath: []
      }

      impactSetter['impactRanges'].set('memory-1', mockRange)
      ;(mockPrisma.memoryRelation.findMany as jest.Mock).mockResolvedValue(mockRelations)

      const analysis = await impactSetter.calculatePropagation('memory-1')

      expect(analysis.directImpact).toBeGreaterThan(0)
      expect(analysis.propagatedImpact).toBeGreaterThan(0)
      expect(analysis.coverage.memories.length).toBeGreaterThan(1)
    })

    test('应该处理无影响范围的情况', async () => {
      await expect(impactSetter.calculatePropagation('invalid-id')).rejects.toThrow()
    })

    test('应该遵守最大传播深度限制', async () => {
      const mockRange = {
        memoryId: 'memory-1',
        affectedChapters: [
          { chapterId: 'chapter-1', strength: 0.8, priority: 'high' }
        ],
        propagationPath: []
      }

      impactSetter['impactRanges'].set('memory-1', mockRange)
      ;(mockPrisma.memoryRelation.findMany as jest.Mock).mockResolvedValue(mockRelations)

      const analysis = await impactSetter.calculatePropagation('memory-1')
      expect(analysis.metrics.propagationDepth).toBeLessThanOrEqual(
        impactSetter.getConfig().propagation.maxDepth
      )
    })
  })

  describe('衰减规则', () => {
    test('应该正确计算线性衰减', () => {
      impactSetter.setDecayRules({ mode: 'linear', rate: 0.2 })
      const strength = impactSetter['calculateDecay'](2)
      expect(strength).toBe(0.6) // 1 - (0.2 * 2)
    })

    test('应该正确计算指数衰减', () => {
      impactSetter.setDecayRules({ mode: 'exponential', rate: 0.8 })
      const strength = impactSetter['calculateDecay'](2)
      expect(strength).toBe(0.64) // 0.8^2
    })

    test('应该遵守最小强度限制', () => {
      impactSetter.setDecayRules({ mode: 'exponential', rate: 0.1, minStrength: 0.2 })
      const strength = impactSetter['calculateDecay'](5)
      expect(strength).toBe(0.2)
    })
  })

  describe('配置管理', () => {
    test('应该正确更新衰减规则', () => {
      const newRules = { mode: 'linear' as const, rate: 0.3 }
      impactSetter.setDecayRules(newRules)
      expect(impactSetter.getConfig().decayRules.mode).toBe('linear')
      expect(impactSetter.getConfig().decayRules.rate).toBe(0.3)
    })

    test('应该正确更新传播规则', () => {
      const newRules = { maxDepth: 5, threshold: 0.1 }
      impactSetter.setPropagationRules(newRules)
      expect(impactSetter.getConfig().propagation.maxDepth).toBe(5)
      expect(impactSetter.getConfig().propagation.threshold).toBe(0.1)
    })
  })
}) 