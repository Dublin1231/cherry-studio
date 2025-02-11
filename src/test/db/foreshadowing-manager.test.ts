import { beforeEach, describe, expect, jest, test } from '@jest/globals'

import type { Foreshadowing, ForeshadowingInput, ForeshadowingUpdate } from '../../main/db/foreshadowing-manager'
import { ForeshadowingManager } from '../../main/db/foreshadowing-manager'
import { MLPredictor } from '../../main/db/ml-predictor'
import { prisma } from '../../main/db/prisma'

// Mock Prisma
jest.mock('../../main/db/prisma', () => ({
  prisma: {
    foreshadowing: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn()
    }
  }
}))

// Mock ML Predictor
jest.mock('../../main/db/ml-predictor', () => ({
  MLPredictor: jest.fn().mockImplementation(() => ({
    predict: jest.fn().mockResolvedValue([
      {
        type: 'importance_prediction',
        details: 'medium',
        severity: 'medium',
        confidence: 0.8,
        suggestion: '根据上下文预测的重要性',
        metadata: {
          input_length: 100
        }
      }
    ])
  }))
}))

describe('ForeshadowingManager', () => {
  let manager: ForeshadowingManager
  let mlPredictor: MLPredictor

  const mockForeshadowing: Foreshadowing = {
    id: 'test-id',
    novelId: 'novel-id',
    content: 'Test foreshadowing content',
    plantedAt: 1,
    expectedAt: 5,
    status: 'planted',
    createdAt: new Date(),
    updatedAt: new Date()
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mlPredictor = new MLPredictor()
    manager = new ForeshadowingManager(mlPredictor)
  })

  describe('createForeshadowing', () => {
    test('should create a new foreshadowing', async () => {
      const input: ForeshadowingInput = {
        novelId: 'novel-id',
        content: 'Test foreshadowing content',
        plantedAt: 1,
        expectedAt: 5
      }

      ;(prisma.foreshadowing.create as jest.Mock).mockResolvedValue(mockForeshadowing)

      const result = await manager.createForeshadowing(input)

      expect(prisma.foreshadowing.create).toHaveBeenCalled()
      expect(result).toEqual(mockForeshadowing)
    })
  })

  describe('updateForeshadowing', () => {
    test('should update an existing foreshadowing', async () => {
      const update: ForeshadowingUpdate = {
        status: 'recalled'
      }

      const updatedForeshadowing = {
        ...mockForeshadowing,
        ...update,
        updatedAt: new Date()
      }

      ;(prisma.foreshadowing.update as jest.Mock).mockResolvedValue(updatedForeshadowing)

      const result = await manager.updateForeshadowing('test-id', update)

      expect(prisma.foreshadowing.update).toHaveBeenCalledWith({
        where: { id: 'test-id' },
        data: {
          ...update,
          updatedAt: expect.any(Date)
        }
      })
      expect(result).toEqual(updatedForeshadowing)
    })
  })

  describe('checkForeshadowingHealth', () => {
    test('should identify health issues', async () => {
      const oldForeshadowing = {
        ...mockForeshadowing,
        createdAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000) // 40 days ago
      }

      ;(prisma.foreshadowing.findMany as jest.Mock).mockResolvedValue([oldForeshadowing])

      const result = await manager.checkForeshadowingHealth('novel-id')

      expect(result.length).toBeGreaterThan(0)
      expect(result[0].type).toBe('long_pending_foreshadowing')
      expect(result[0].severity).toBe('medium')
    })
  })

  describe('analyzeForeshadowings', () => {
    test('should analyze foreshadowings and return statistics', async () => {
      const mockForeshadowings = [
        { ...mockForeshadowing, status: 'planted' },
        { ...mockForeshadowing, id: 'test-2', status: 'recalled' },
        { ...mockForeshadowing, id: 'test-3', status: 'recalled' }
      ]
      ;(prisma.foreshadowing.findMany as jest.Mock).mockResolvedValue(mockForeshadowings)

      const result = await manager.analyzeForeshadowings('novel-id')

      expect(result.totalCount).toBe(3)
      expect(result.activeCount).toBe(1)
      expect(result.resolvedCount).toBe(2)
      expect(result.abandonedCount).toBe(0)
    })
  })
})
