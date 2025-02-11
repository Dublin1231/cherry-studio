import { performanceMonitor } from './performance-monitor'

interface ErrorPattern {
  type: string
  pattern: RegExp | string
  severity: 'low' | 'medium' | 'high'
  category: 'database' | 'network' | 'validation' | 'system' | 'business' | 'unknown'
  suggestion?: string
  relatedPatterns?: string[]
  impactScope?: 'local' | 'global'
  recoveryStrategy?: string
}

interface ErrorAnalysis {
  originalError: Error
  type: string
  category: ErrorPattern['category']
  severity: ErrorPattern['severity']
  timestamp: number
  context?: Record<string, any>
  suggestion?: string
  relatedErrors?: ErrorSummary[]
  rootCause?: {
    type: string
    probability: number
    evidence: string[]
  }
  impactAnalysis?: {
    scope: 'local' | 'global'
    affectedComponents: string[]
    estimatedRecoveryTime: number
  }
  correlationScore?: number
}

type ErrorTrend = 'increasing' | 'decreasing' | 'stable'

interface ErrorSummary {
  type: string
  count: number
  lastOccurrence: number
  avgFrequency: number
  trend: ErrorTrend
  severity?: string
}

function createErrorSummary(
  type: string,
  count: number,
  lastOccurrence: number,
  avgFrequency: number,
  trend: ErrorTrend
): ErrorSummary {
  return {
    type,
    count,
    lastOccurrence,
    avgFrequency,
    trend
  }
}

interface ErrorStats {
  totalErrors: number
  categoryDistribution: Record<ErrorPattern['category'], number>
  severityDistribution: Record<ErrorPattern['severity'], number>
  mostFrequentErrors: ErrorSummary[]
  recentErrors: ErrorAnalysis[]
}

export class ErrorAnalyzer {
  private static instance: ErrorAnalyzer
  private errorPatterns: ErrorPattern[] = [
    {
      type: 'database_connection',
      pattern: /(ECONNREFUSED|connection.*refused|cannot.*connect.*database)/i,
      severity: 'high',
      category: 'database',
      suggestion: '请检查数据库连接配置和数据库服务是否正常运行'
    },
    {
      type: 'database_constraint',
      pattern: /(unique.*constraint|foreign.*key|check.*constraint)/i,
      severity: 'medium',
      category: 'database',
      suggestion: '请检查数据完整性约束条件'
    },
    {
      type: 'network_timeout',
      pattern: /(ETIMEDOUT|timeout|connection.*timed.*out)/i,
      severity: 'medium',
      category: 'network',
      suggestion: '请检查网络连接和超时设置'
    },
    {
      type: 'validation_error',
      pattern: /(invalid.*input|validation.*failed|required.*field)/i,
      severity: 'low',
      category: 'validation',
      suggestion: '请检查输入数据的有效性'
    },
    {
      type: 'memory_error',
      pattern: /(out.*of.*memory|heap.*overflow|memory.*leak)/i,
      severity: 'high',
      category: 'system',
      suggestion: '请检查内存使用情况并考虑优化内存管理'
    },
    {
      type: 'business_logic',
      pattern: /(invalid.*state|operation.*not.*allowed|business.*rule)/i,
      severity: 'medium',
      category: 'business',
      suggestion: '请检查业务逻辑和状态转换是否正确'
    }
  ]

  private errorHistory: ErrorAnalysis[] = []
  private readonly MAX_HISTORY_LENGTH = 1000

  private constructor() {
    setInterval(() => this.cleanOldErrors(), 24 * 60 * 60 * 1000)
    setInterval(() => this.analyzeErrorTrends(), 60 * 60 * 1000)
  }

  static getInstance(): ErrorAnalyzer {
    if (!ErrorAnalyzer.instance) {
      ErrorAnalyzer.instance = new ErrorAnalyzer()
    }
    return ErrorAnalyzer.instance
  }

  analyzeError(error: Error, context?: Record<string, any>): ErrorAnalysis {
    const analysis: ErrorAnalysis = {
      originalError: error,
      type: 'unknown',
      category: 'unknown',
      severity: 'medium',
      timestamp: Date.now(),
      context
    }

    // 匹配错误模式
    for (const pattern of this.errorPatterns) {
      if (
        (pattern.pattern instanceof RegExp && pattern.pattern.test(error.message)) ||
        (typeof pattern.pattern === 'string' && error.message.includes(pattern.pattern))
      ) {
        analysis.type = pattern.type
        analysis.category = pattern.category
        analysis.severity = pattern.severity
        analysis.suggestion = pattern.suggestion
        break
      }
    }

    // 查找相关错误
    analysis.relatedErrors = this.findRelatedErrors(analysis)

    // 记录错误
    this.recordError(analysis)

    return analysis
  }

  getErrorStats(timeRange?: { start: number; end: number }): ErrorStats {
    let errors = this.errorHistory
    if (timeRange) {
      errors = errors.filter((e) => e.timestamp >= timeRange.start && e.timestamp <= timeRange.end)
    }

    const stats: ErrorStats = {
      totalErrors: errors.length,
      categoryDistribution: {
        database: 0,
        network: 0,
        validation: 0,
        system: 0,
        business: 0,
        unknown: 0
      },
      severityDistribution: {
        low: 0,
        medium: 0,
        high: 0
      },
      mostFrequentErrors: [],
      recentErrors: errors.slice(-10)
    }

    // 计算分布
    for (const error of errors) {
      stats.categoryDistribution[error.category]++
      stats.severityDistribution[error.severity]++
    }

    // 计算最频繁的错误类型
    const errorCounts = new Map<string, { count: number; lastOccurrence: number; timestamps: number[] }>()
    for (const error of errors) {
      if (!errorCounts.has(error.type)) {
        errorCounts.set(error.type, { count: 0, lastOccurrence: 0, timestamps: [] })
      }
      const entry = errorCounts.get(error.type)!
      entry.count++
      entry.lastOccurrence = Math.max(entry.lastOccurrence, error.timestamp)
      entry.timestamps.push(error.timestamp)
    }

    // 生成 ErrorSummary 列表
    stats.mostFrequentErrors = Array.from(errorCounts.entries())
      .map(([type, data]) => {
        const hoursSinceFirst = (Date.now() - Math.min(...data.timestamps)) / (60 * 60 * 1000)
        const avgFrequency = data.count / (hoursSinceFirst || 1)

        // 计算趋势
        const recentCount = data.timestamps.filter((t) => t > Date.now() - 60 * 60 * 1000).length
        const previousCount = data.timestamps.filter(
          (t) => t <= Date.now() - 60 * 60 * 1000 && t > Date.now() - 2 * 60 * 60 * 1000
        ).length
        const trend: ErrorTrend =
          recentCount > previousCount * 1.2 ? 'increasing' : recentCount < previousCount * 0.8 ? 'decreasing' : 'stable'

        return {
          type,
          count: data.count,
          lastOccurrence: data.lastOccurrence,
          avgFrequency,
          trend
        }
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)

    return stats
  }

  addErrorPattern(pattern: ErrorPattern): void {
    this.errorPatterns.push(pattern)
  }

  private findRelatedErrors(currentError: ErrorAnalysis): ErrorSummary[] {
    // 设置时间窗口，查找可能相关的错误
    const timeWindow = 15 * 60 * 1000 // 15分钟
    const potentiallyRelated = this.errorHistory.filter(
      (e) => Math.abs(e.timestamp - currentError.timestamp) <= timeWindow
    )

    // 计算错误之间的相似度
    const patternSimilarity = (error1: ErrorAnalysis, error2: ErrorAnalysis): number => {
      let score = 0
      if (error1.category === error2.category) score += 0.3
      if (error1.severity === error2.severity) score += 0.2
      if (error1.type === error2.type) score += 0.5
      return score
    }

    // 计算上下文相似度
    const contextSimilarity = (error1: ErrorAnalysis, error2: ErrorAnalysis): number => {
      if (!error1.context || !error2.context) return 0
      const keys1 = Object.keys(error1.context)
      const keys2 = Object.keys(error2.context)
      const commonKeys = keys1.filter((k) => keys2.includes(k))
      return commonKeys.length / Math.max(keys1.length, keys2.length)
    }

    // 计算错误链
    const calculateErrorChain = (error: ErrorAnalysis): string[] => {
      const chain: string[] = [error.type]
      let currentError = error
      while (currentError.relatedErrors && currentError.relatedErrors.length > 0) {
        const nextError = currentError.relatedErrors[0]
        if (chain.includes(nextError.type)) break // 避免循环
        chain.push(nextError.type)
        const nextErrorFull = this.errorHistory.find(
          (e) => e.type === nextError.type && e.timestamp === nextError.lastOccurrence
        )
        if (!nextErrorFull) break
        currentError = nextErrorFull
      }
      return chain
    }

    // 找出相关错误并计算相关性分数
    const relatedErrors = potentiallyRelated
      .map((error) => {
        const patternScore = patternSimilarity(currentError, error)
        const contextScore = contextSimilarity(currentError, error)
        const chain1 = calculateErrorChain(currentError)
        const chain2 = calculateErrorChain(error)
        const chainSimilarity = chain1.filter((t) => chain2.includes(t)).length / Math.max(chain1.length, chain2.length)

        return {
          error,
          score: patternScore * 0.4 + contextScore * 0.3 + chainSimilarity * 0.3
        }
      })
      .filter((result) => result.score > 0.5)
      .sort((a, b) => b.score - a.score)

    // 转换为 ErrorSummary 格式
    return relatedErrors.map((result) => createErrorSummary(result.error.type, 1, result.error.timestamp, 0, 'stable'))
  }

  private recordError(error: ErrorAnalysis): void {
    this.errorHistory.push(error)
    if (this.errorHistory.length > this.MAX_HISTORY_LENGTH) {
      this.errorHistory.shift()
    }
    performanceMonitor.recordError('error_analyzer', error.originalError, {
      type: error.type,
      category: error.category,
      severity: error.severity
    })
  }

  private cleanOldErrors(): void {
    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    this.errorHistory = this.errorHistory.filter((error) => error.timestamp > oneWeekAgo)
  }

  private analyzeErrorTrends(): void {
    const stats = this.getErrorStats()
    for (const error of stats.mostFrequentErrors) {
      if (error.trend === 'increasing') {
        performanceMonitor.recordError('error_trend', new Error(`错误类型 ${error.type} 的发生频率呈上升趋势`), {
          type: error.type,
          count: error.count,
          avgFrequency: error.avgFrequency
        })
      }
    }
  }
}

export const errorAnalyzer = ErrorAnalyzer.getInstance()
