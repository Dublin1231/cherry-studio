import { EventEmitter } from 'events'

import { ModelAPI } from './model-api'
import { qualityAssessmentManager } from './quality-assessment-manager'

export interface ParameterConfig {
  temperature: number
  topP: number
  frequencyPenalty: number
  presencePenalty: number
  maxTokens?: number
}

export interface AdjustmentStrategy {
  qualityThreshold: number
  temperatureRange: [number, number]
  topPRange: [number, number]
  frequencyPenaltyRange: [number, number]
  presencePenaltyRange: [number, number]
  maxTokensRange?: [number, number]
}

export interface ParameterAdjustmentResult {
  originalParams: ParameterConfig
  adjustedParams: ParameterConfig
  adjustmentReason: string
  qualityScore: number
  timestamp: number
}

export class ParameterAdjustmentManager extends EventEmitter {
  private static instance: ParameterAdjustmentManager
  private model: ModelAPI
  private strategy: AdjustmentStrategy
  private adjustmentHistory: ParameterAdjustmentResult[] = []
  private baselineQuality: number = 0.7

  private constructor(model: ModelAPI) {
    super()
    this.model = model
    this.strategy = {
      qualityThreshold: 0.7,
      temperatureRange: [0.1, 1.0],
      topPRange: [0.1, 1.0],
      frequencyPenaltyRange: [0.0, 2.0],
      presencePenaltyRange: [0.0, 2.0],
      maxTokensRange: [100, 4000]
    }
  }

  static getInstance(model: ModelAPI): ParameterAdjustmentManager {
    if (!ParameterAdjustmentManager.instance) {
      ParameterAdjustmentManager.instance = new ParameterAdjustmentManager(model)
    }
    return ParameterAdjustmentManager.instance
  }

  // 设置调整策略
  setStrategy(strategy: Partial<AdjustmentStrategy>): void {
    this.strategy = { ...this.strategy, ...strategy }
    this.emit('strategy:updated', this.strategy)
  }

  // 获取当前策略
  getStrategy(): AdjustmentStrategy {
    return { ...this.strategy }
  }

  // 动态调整参数
  async adjustParameters(
    params: ParameterConfig,
    content: string,
    taskType: 'creative' | 'factual' | 'technical'
  ): Promise<ParameterAdjustmentResult> {
    // 评估当前内容质量
    const assessment = await qualityAssessmentManager.assessTextQuality(content)
    const qualityScore = assessment.metrics.overallScore

    // 初始化调整后的参数
    let adjustedParams = { ...params }
    let adjustmentReason = ''

    // 根据任务类型和质量评估结果调整参数
    if (qualityScore < this.strategy.qualityThreshold) {
      switch (taskType) {
        case 'creative':
          // 提高创造性输出的参数
          adjustedParams = this.adjustCreativeParameters(params, qualityScore)
          adjustmentReason = '提高创造性输出质量'
          break
        case 'factual':
          // 提高事实准确性的参数
          adjustedParams = this.adjustFactualParameters(params, qualityScore)
          adjustmentReason = '提高事实准确性'
          break
        case 'technical':
          // 提高技术内容质量的参数
          adjustedParams = this.adjustTechnicalParameters(params, qualityScore)
          adjustmentReason = '提高技术内容质量'
          break
      }
    } else {
      adjustmentReason = '当前参数表现良好，无需调整'
    }

    // 记录调整结果
    const result: ParameterAdjustmentResult = {
      originalParams: params,
      adjustedParams,
      adjustmentReason,
      qualityScore,
      timestamp: Date.now()
    }

    this.adjustmentHistory.push(result)
    this.emit('parameters:adjusted', result)

    return result
  }

  // 调整创造性任务的参数
  private adjustCreativeParameters(params: ParameterConfig, qualityScore: number): ParameterConfig {
    const delta = this.strategy.qualityThreshold - qualityScore
    return {
      ...params,
      temperature: this.clamp(
        params.temperature + delta * 0.3,
        this.strategy.temperatureRange[0],
        this.strategy.temperatureRange[1]
      ),
      topP: this.clamp(params.topP + delta * 0.2, this.strategy.topPRange[0], this.strategy.topPRange[1]),
      frequencyPenalty: this.clamp(
        params.frequencyPenalty + delta * 0.4,
        this.strategy.frequencyPenaltyRange[0],
        this.strategy.frequencyPenaltyRange[1]
      )
    }
  }

  // 调整事实性任务的参数
  private adjustFactualParameters(params: ParameterConfig, qualityScore: number): ParameterConfig {
    const delta = this.strategy.qualityThreshold - qualityScore
    return {
      ...params,
      temperature: this.clamp(
        params.temperature - delta * 0.4,
        this.strategy.temperatureRange[0],
        this.strategy.temperatureRange[1]
      ),
      topP: this.clamp(params.topP - delta * 0.3, this.strategy.topPRange[0], this.strategy.topPRange[1]),
      presencePenalty: this.clamp(
        params.presencePenalty + delta * 0.2,
        this.strategy.presencePenaltyRange[0],
        this.strategy.presencePenaltyRange[1]
      )
    }
  }

  // 调整技术任务的参数
  private adjustTechnicalParameters(params: ParameterConfig, qualityScore: number): ParameterConfig {
    const delta = this.strategy.qualityThreshold - qualityScore
    return {
      ...params,
      temperature: this.clamp(
        params.temperature - delta * 0.5,
        this.strategy.temperatureRange[0],
        this.strategy.temperatureRange[1]
      ),
      topP: this.clamp(params.topP - delta * 0.4, this.strategy.topPRange[0], this.strategy.topPRange[1]),
      maxTokens: params.maxTokens
        ? this.clamp(
            params.maxTokens + Math.round(delta * 500),
            this.strategy.maxTokensRange![0],
            this.strategy.maxTokensRange![1]
          )
        : undefined
    }
  }

  // 辅助函数：将值限制在指定范围内
  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value))
  }

  // 获取调整历史
  getAdjustmentHistory(): ParameterAdjustmentResult[] {
    return [...this.adjustmentHistory]
  }

  // 清除调整历史
  clearAdjustmentHistory(): void {
    this.adjustmentHistory = []
    this.emit('history:cleared')
  }

  // 分析参数调整效果
  async analyzeAdjustmentEffectiveness(): Promise<{
    effectiveness: number
    recommendations: string[]
  }> {
    if (this.adjustmentHistory.length < 2) {
      return {
        effectiveness: 0,
        recommendations: ['需要更多数据来评估调整效果']
      }
    }

    const recentAdjustments = this.adjustmentHistory.slice(-10)
    const qualityScores = recentAdjustments.map((result) => result.qualityScore)
    const averageQuality = qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length
    const qualityTrend = this.calculateTrend(qualityScores)

    const effectiveness = (averageQuality - this.baselineQuality) / this.baselineQuality
    const recommendations: string[] = []

    if (qualityTrend > 0.1) {
      recommendations.push('当前参数调整策略有效，建议继续使用')
    } else if (qualityTrend < -0.1) {
      recommendations.push('当前参数调整策略可能需要优化，建议重新评估调整范围')
    } else {
      recommendations.push('参数调整效果稳定，可以考虑微调以进一步提升质量')
    }

    return {
      effectiveness,
      recommendations
    }
  }

  // 计算趋势
  private calculateTrend(values: number[]): number {
    if (values.length < 2) return 0
    const xMean = (values.length - 1) / 2
    const yMean = values.reduce((a, b) => a + b, 0) / values.length

    let numerator = 0
    let denominator = 0

    values.forEach((y, x) => {
      numerator += (x - xMean) * (y - yMean)
      denominator += Math.pow(x - xMean, 2)
    })

    return denominator === 0 ? 0 : numerator / denominator
  }
}

// 创建参数调整管理器实例
export const parameterAdjustmentManager = ParameterAdjustmentManager.getInstance(
  new ModelAPI({
    type: 'anthropic',
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    modelName: 'claude-2'
  })
)
