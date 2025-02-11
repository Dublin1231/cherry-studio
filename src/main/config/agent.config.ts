import { AgentType } from '../agents/types'

export const agentConfigs = {
  [AgentType.CREATION]: {
    id: 'creation-agent',
    name: '创作智能体',
    type: AgentType.CREATION,
    priority: 1,
    modelConfig: {
      endpoint: process.env.MODEL_ENDPOINT || 'http://localhost:8000',
      apiKey: process.env.MODEL_API_KEY,
      temperature: 0.7,
      maxTokens: 2000
    },
    stylePresets: {
      xianxia: {
        temperature: 0.65,
        topP: 0.9,
        repetitionPenalty: 1.2,
        typicalP: 0.95
      },
      modern: {
        temperature: 0.75,
        topP: 0.85,
        repetitionPenalty: 1.1,
        typicalP: 0.9
      }
    }
  },

  [AgentType.VALIDATION]: {
    id: 'validation-agent',
    name: '校验智能体',
    type: AgentType.VALIDATION,
    priority: 2,
    strictMode: true,
    checkDepth: 10,
    allowTemporalError: 0.05,
    autoCorrection: true
  },

  [AgentType.MEMORY]: {
    id: 'memory-agent',
    name: '记忆管家',
    type: AgentType.MEMORY,
    priority: 3,
    vectorDbConfig: {
      endpoint: process.env.VECTOR_DB_ENDPOINT || 'http://localhost:8001',
      dimension: 768,
      collection: 'memory_anchors'
    },
    cacheSize: 10000,
    weightDecayFactor: 0.95
  }
}
