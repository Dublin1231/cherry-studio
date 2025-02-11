// 扩展 PrismaClient 类型
declare module '@prisma/client' {
  interface PrismaClient {
    consistencyIssue: {
      findMany: () => Promise<ConsistencyIssue[]>
      create: (data: Partial<ConsistencyIssue>) => Promise<ConsistencyIssue>
      update: (data: { where: any; data: Partial<ConsistencyIssue> }) => Promise<ConsistencyIssue>
      delete: (data: { where: any }) => Promise<ConsistencyIssue>
      count: (args?: { where: any }) => Promise<number>
    }
    consistencyCheck: {
      findMany: () => Promise<ConsistencyCheck[]>
      create: (data: Partial<ConsistencyCheck>) => Promise<ConsistencyCheck>
      update: (data: { where: any; data: Partial<ConsistencyCheck> }) => Promise<ConsistencyCheck>
      count: (args?: { where: any }) => Promise<number>
    }
  }
}

// 一致性问题
export interface ConsistencyIssue {
  id: string
  type: string
  description: string
  details: string
  severity: 'high' | 'medium' | 'low'
  status: 'open' | 'fixed' | 'ignored'
  autoFixable: boolean
  fixSuggestion: string
  metadata: Record<string, any>
  createdAt: Date
  updatedAt: Date
}

export interface ConsistencyIssueInput {
  type: string
  details: string
  severity: 'high' | 'medium' | 'low'
  autoFixable: boolean
  fixSuggestion: string
  metadata: Record<string, any>
}

// 一致性检查
export interface ConsistencyCheck {
  id: string
  type: string
  result: 'pass' | 'fail'
  details: string
  createdAt: Date
}

// ML预测器类型定义
export interface MLPredictor {
  getPredictions: () => Promise<Prediction[]>
  getModelStatus: () => Promise<ModelStatus>
  predict: (data: any) => Promise<PredictionResult>
}

export interface Prediction {
  type: string
  probability: number
  timeFrame: {
    start: Date
    end: Date
  }
  impact: 'high' | 'medium' | 'low'
}

export interface ModelStatus {
  accuracy: number
  totalPredictions: number
  highPriority: number
}

export interface PredictionResult {
  prediction: string
  confidence: number
  features: string[]
}

// 报告数据类型
export interface ReportData {
  timestamp: Date
  period: string
  performance: {
    summary: {
      avgResponseTime: number
      errorRate: number
      throughput: number
      resourceUsage: {
        cpu: number
        memory: number
        disk: number
        network: number
      }
    }
    trends: Array<{
      metric: string
      timestamps: string[]
      values: number[]
    }>
    hotspots: Array<{
      operation: string
      metric: string
      value: number
      threshold: number
    }>
  }
  errors: {
    summary: {
      totalCount: number
      uniqueTypes: number
      criticalCount: number
      resolvedCount: number
    }
    distribution: {
      byCategory: Record<string, number>
      bySeverity: Record<string, number>
      byTime: Array<{
        timestamp: string
        count: number
      }>
    }
    topIssues: Array<{
      type: string
      count: number
      trend: 'increasing' | 'decreasing' | 'stable'
      impact: 'high' | 'medium' | 'low'
    }>
  }
  consistency: {
    summary: {
      totalChecks: number
      passedChecks: number
      failedChecks: number
      fixedIssues: number
    }
    issues: Array<{
      type: string
      count: number
      severity: 'high' | 'medium' | 'low'
      status: 'open' | 'fixed' | 'ignored'
    }>
    trends: Array<{
      metric: string
      timestamps: string[]
      values: number[]
    }>
  }
  predictions: {
    summary: {
      totalPredictions: number
      highPriority: number
      accuracy: number
    }
    upcoming: Array<{
      type: string
      probability: number
      timeFrame: {
        start: Date
        end: Date
      }
      impact: 'high' | 'medium' | 'low'
    }>
    preventiveActions: Array<{
      action: string
      priority: 'high' | 'medium' | 'low'
      deadline: Date
    }>
  }
}

// 图表相关类型
export interface ChartConfig {
  type: 'line' | 'bar' | 'pie' | 'radar'
  title: string
  data: ChartData
  options?: any
}

export interface ChartData {
  labels: string[]
  datasets: Array<{
    label: string
    data: number[]
    backgroundColor?: string | string[]
    borderColor?: string | string[]
    fill?: boolean
  }>
}

export interface MLPrediction {
  type: string
  details: string
  severity: string
  confidence: number
  suggestion: string
  metadata?: Record<string, any>
}

export interface Foreshadowing {
  id: string
  novelId: string
  setupChapterId: string
  type: 'character' | 'plot' | 'setting'
  description: string
  importance: 'high' | 'medium' | 'low'
  status: 'setup' | 'active' | 'resolved' | 'abandoned'
  setupContext: string
  relatedCharacters: string[]
  metadata: Record<string, any>
  createdAt: Date
  updatedAt: Date
}

export interface ForeshadowingInput {
  novelId: string
  setupChapterId: string
  type: 'character' | 'plot' | 'setting'
  description: string
  importance: 'high' | 'medium' | 'low'
  setupContext: string
  relatedCharacters: string[]
}

export interface ForeshadowingUpdate {
  status?: 'setup' | 'active' | 'resolved' | 'abandoned'
  metadata?: Record<string, any>
}

import { Prisma } from '@prisma/client'

export interface MemoryAnchor {
  id: string
  novelId: string
  chapterId: string
  type: string // character, location, item, event
  content: string
  embedding?: Buffer // 向量嵌入
  weight: number
  createdAt: Date
  
  // 关联
  novel?: {
    id: string
    title: string
  }
  chapter?: {
    id: string
    number: number
    title: string
  }
  
  // 关系
  relations?: Array<{
    id: string
    targetId: string
    type: string
    weight: number
  }>
  relatedTo?: Array<{
    id: string
    sourceId: string
    type: string
    weight: number
  }>
}

// ... existing code ...
