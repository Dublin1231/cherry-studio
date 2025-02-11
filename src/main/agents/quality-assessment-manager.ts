import { EventEmitter } from 'events'
import { ModelAPI } from './model-api'

export interface QualityMetrics {
  // 内容质量
  coherence: number // 连贯性 (0-1)
  relevance: number // 相关性 (0-1)
  accuracy: number // 准确性 (0-1)
  completeness: number // 完整性 (0-1)
  
  // 语言质量
  grammar: number // 语法 (0-1)
  readability: number // 可读性 (0-1)
  fluency: number // 流畅度 (0-1)
  
  // 技术质量
  codeQuality?: number // 代码质量 (0-1)
  documentation?: number // 文档质量 (0-1)
  testCoverage?: number // 测试覆盖率 (0-1)
  
  // 整体评分
  overallScore: number // 总体评分 (0-1)
}

export interface QualityAssessmentResult {
  metrics: QualityMetrics
  issues: Array<{
    type: string
    severity: 'low' | 'medium' | 'high'
    description: string
    suggestion?: string
  }>
  suggestions: string[]
  timestamp: number
}

export interface QualityThresholds {
  minCoherence: number
  minRelevance: number
  minAccuracy: number
  minCompleteness: number
  minGrammar: number
  minReadability: number
  minFluency: number
  minCodeQuality?: number
  minDocumentation?: number
  minTestCoverage?: number
  minOverallScore: number
}

export class QualityAssessmentManager extends EventEmitter {
  private static instance: QualityAssessmentManager
  private model: ModelAPI
  private thresholds: QualityThresholds
  private assessmentHistory: QualityAssessmentResult[] = []

  private constructor(model: ModelAPI) {
    super()
    this.model = model
    this.thresholds = {
      minCoherence: 0.7,
      minRelevance: 0.7,
      minAccuracy: 0.8,
      minCompleteness: 0.7,
      minGrammar: 0.8,
      minReadability: 0.7,
      minFluency: 0.7,
      minCodeQuality: 0.7,
      minDocumentation: 0.7,
      minTestCoverage: 0.7,
      minOverallScore: 0.75
    }
  }

  static getInstance(model: ModelAPI): QualityAssessmentManager {
    if (!QualityAssessmentManager.instance) {
      QualityAssessmentManager.instance = new QualityAssessmentManager(model)
    }
    return QualityAssessmentManager.instance
  }

  // 设置质量阈值
  setThresholds(thresholds: Partial<QualityThresholds>): void {
    this.thresholds = { ...this.thresholds, ...thresholds }
    this.emit('thresholds:updated', this.thresholds)
  }

  // 获取当前阈值
  getThresholds(): QualityThresholds {
    return { ...this.thresholds }
  }

  // 评估文本质量
  async assessTextQuality(text: string): Promise<QualityAssessmentResult> {
    const prompt = `
请对以下文本进行质量评估：

文本内容：
${text}

请从以下方面进行评估，并给出0-1之间的分数：

1. 内容质量：
- 连贯性：内容是否流畅连贯
- 相关性：内容是否切题
- 准确性：信息是否准确
- 完整性：内容是否完整

2. 语言质量：
- 语法：是否符合语法规范
- 可读性：是否易于理解
- 流畅度：表达是否自然流畅

请同时列出发现的问题和改进建议。

以JSON格式输出评估结果。
`

    try {
      const response = await this.model.generate({
        prompt,
        temperature: 0.3
      })

      const result: QualityAssessmentResult = {
        ...JSON.parse(response),
        timestamp: Date.now()
      }

      this.assessmentHistory.push(result)
      this.emit('assessment:completed', result)

      return result
    } catch (error) {
      console.error('质量评估失败:', error)
      throw error
    }
  }

  // 评估代码质量
  async assessCodeQuality(code: string): Promise<QualityAssessmentResult> {
    const prompt = `
请对以下代码进行质量评估：

代码：
${code}

请从以下方面进行评估，并给出0-1之间的分数：

1. 代码质量：
- 可读性
- 可维护性
- 复杂度
- 性能
- 安全性

2. 文档质量：
- 注释完整性
- 文档规范性

3. 测试覆盖：
- 单元测试覆盖率
- 测试用例完整性

请同时列出发现的问题和改进建议。

以JSON格式输出评估结果。
`

    try {
      const response = await this.model.generate({
        prompt,
        temperature: 0.3
      })

      const result: QualityAssessmentResult = {
        ...JSON.parse(response),
        timestamp: Date.now()
      }

      this.assessmentHistory.push(result)
      this.emit('assessment:completed', result)

      return result
    } catch (error) {
      console.error('代码质量评估失败:', error)
      throw error
    }
  }

  // 检查是否满足质量阈值
  checkQualityThresholds(metrics: QualityMetrics): {
    passed: boolean
    failures: Array<{
      metric: keyof QualityMetrics
      actual: number
      required: number
    }>
  } {
    const failures: Array<{
      metric: keyof QualityMetrics
      actual: number
      required: number
    }> = []

    // 检查每个指标
    Object.entries(this.thresholds).forEach(([key, threshold]) => {
      const metricKey = key.replace('min', '').toLowerCase() as keyof QualityMetrics
      const metricValue = metrics[metricKey]

      if (metricValue !== undefined && metricValue < threshold) {
        failures.push({
          metric: metricKey,
          actual: metricValue,
          required: threshold
        })
      }
    })

    return {
      passed: failures.length === 0,
      failures
    }
  }

  // 获取评估历史
  getAssessmentHistory(): QualityAssessmentResult[] {
    return [...this.assessmentHistory]
  }

  // 清除评估历史
  clearAssessmentHistory(): void {
    this.assessmentHistory = []
    this.emit('history:cleared')
  }

  // 生成质量报告
  generateQualityReport(result: QualityAssessmentResult): string {
    const { metrics, issues, suggestions } = result
    const thresholdCheck = this.checkQualityThresholds(metrics)

    return `
质量评估报告
============

评估时间: ${new Date(result.timestamp).toLocaleString()}

质量指标
--------
内容质量:
- 连贯性: ${(metrics.coherence * 100).toFixed(1)}% ${metrics.coherence < this.thresholds.minCoherence ? '⚠️' : '✓'}
- 相关性: ${(metrics.relevance * 100).toFixed(1)}% ${metrics.relevance < this.thresholds.minRelevance ? '⚠️' : '✓'}
- 准确性: ${(metrics.accuracy * 100).toFixed(1)}% ${metrics.accuracy < this.thresholds.minAccuracy ? '⚠️' : '✓'}
- 完整性: ${(metrics.completeness * 100).toFixed(1)}% ${metrics.completeness < this.thresholds.minCompleteness ? '⚠️' : '✓'}

语言质量:
- 语法: ${(metrics.grammar * 100).toFixed(1)}% ${metrics.grammar < this.thresholds.minGrammar ? '⚠️' : '✓'}
- 可读性: ${(metrics.readability * 100).toFixed(1)}% ${metrics.readability < this.thresholds.minReadability ? '⚠️' : '✓'}
- 流畅度: ${(metrics.fluency * 100).toFixed(1)}% ${metrics.fluency < this.thresholds.minFluency ? '⚠️' : '✓'}

${metrics.codeQuality ? `
技术质量:
- 代码质量: ${(metrics.codeQuality * 100).toFixed(1)}% ${metrics.codeQuality < (this.thresholds.minCodeQuality || 0) ? '⚠️' : '✓'}
- 文档质量: ${(metrics.documentation ? (metrics.documentation * 100).toFixed(1) : 'N/A')}% ${metrics.documentation && metrics.documentation < (this.thresholds.minDocumentation || 0) ? '⚠️' : '✓'}
- 测试覆盖: ${(metrics.testCoverage ? (metrics.testCoverage * 100).toFixed(1) : 'N/A')}% ${metrics.testCoverage && metrics.testCoverage < (this.thresholds.minTestCoverage || 0) ? '⚠️' : '✓'}
` : ''}

总体评分: ${(metrics.overallScore * 100).toFixed(1)}% ${metrics.overallScore < this.thresholds.minOverallScore ? '⚠️' : '✓'}

质量状态: ${thresholdCheck.passed ? '✅ 通过' : '❌ 未通过'}

发现的问题
--------
${issues.map(issue => `[${issue.severity}] ${issue.description}`).join('\n')}

改进建议
--------
${suggestions.map(suggestion => `- ${suggestion}`).join('\n')}
`
  }
}

// 创建质量评估管理器实例
export const qualityAssessmentManager = QualityAssessmentManager.getInstance(
  new ModelAPI({
    type: 'anthropic',
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    modelName: 'claude-2'
  })
) 