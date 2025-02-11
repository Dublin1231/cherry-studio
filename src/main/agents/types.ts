/**
 * 智能体基础类型定义
 */

export interface AgentConfig {
  id: string
  name: string
  type: AgentType
  status: AgentStatus
  priority: number
}

export enum AgentType {
  CREATION = 'creation',
  VALIDATION = 'validation',
  MEMORY = 'memory'
}

export enum AgentStatus {
  IDLE = 'idle',
  BUSY = 'busy',
  ERROR = 'error'
}

export interface AgentMessage {
  id: string
  type: string
  payload: any
  timestamp: number
  sender: string
  receiver: string
  priority: number
}

export interface AgentResult<T = any> {
  success: boolean
  data?: T
  error?: string
  metrics?: {
    startTime: number
    endTime: number
    memoryUsage: number
  }
}

// 创作智能体相关类型
export interface CreationAgentConfig extends AgentConfig {
  modelConfig: {
    endpoint: string
    apiKey?: string
    temperature: number
    maxTokens: number
  }
  stylePresets: Record<string, StylePreset>
}

export interface StylePreset {
  temperature: number
  topP: number
  repetitionPenalty: number
  typicalP: number
}

// 校验智能体相关类型
export interface ValidationAgentConfig extends AgentConfig {
  strictMode: boolean
  checkDepth: number
  allowTemporalError: number
  autoCorrection: boolean
}

// 记忆管家相关类型
export interface MemoryAgentConfig extends AgentConfig {
  vectorDbConfig: {
    endpoint: string
    dimension: number
    collection: string
  }
  cacheSize: number
  weightDecayFactor: number
}
