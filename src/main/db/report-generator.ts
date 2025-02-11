import { PrismaClient } from '@prisma/client'
import { Buffer } from 'buffer'
import { EventEmitter } from 'events'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import { promisify } from 'util'
import { createGunzip, createGzip } from 'zlib'

import { errorAnalyzer } from './error-analyzer'
import { mlPredictor } from './ml-predictor'
import { performanceMonitor } from './performance-monitor'
import { ChartConfig, ChartData, MLPredictor, ReportData } from './types'

const prisma = new PrismaClient()

interface ReportConfig {
  title: string
  period: 'hour' | 'day' | 'week' | 'month'
  sections: Array<'performance' | 'errors' | 'consistency' | 'predictions'>
  format: 'html' | 'markdown' | 'json'
  includeCharts: boolean
  includeTables: boolean
  includeRecommendations: boolean
  compression: boolean
}

// HTML 模板
const HTML_TEMPLATE = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>系统性能报告</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
      color: #333;
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
        }
        .header {
            text-align: center;
      margin-bottom: 40px;
    }
    .timestamp {
      color: #666;
      font-size: 0.9em;
        }
        .section {
            background: #fff;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      padding: 20px;
      margin-bottom: 30px;
    }
    .section h2 {
      color: #1a73e8;
      margin-top: 0;
        }
        .chart-container {
            position: relative;
            height: 300px;
            margin: 20px 0;
        }
        .metric-grid {
            display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
      margin-bottom: 20px;
    }
    .metric-card {
      background: #f8f9fa;
      border-radius: 6px;
      padding: 15px;
    }
    .metric-card h3 {
      margin: 0 0 10px;
      color: #202124;
      font-size: 1em;
    }
    .metric-card p {
      margin: 0;
      font-size: 1.2em;
      font-weight: 500;
        }
        .status-badge {
            display: inline-block;
            padding: 4px 8px;
            border-radius: 4px;
      font-size: 0.8em;
            font-weight: 500;
        }
    .status-badge.success { background: #e6f4ea; color: #137333; }
    .status-badge.warning { background: #fef7e0; color: #b06000; }
    .status-badge.error { background: #fce8e6; color: #c5221f; }
        @media (max-width: 768px) {
            .metric-grid {
                grid-template-columns: 1fr;
            }
        }
    </style>
</head>
<body>
        <div class="header">
    <h1>系统性能报告</h1>
    <p class="timestamp">生成时间: {{timestamp}}</p>
        </div>

  <div class="section">
    <h2>性能概览</h2>
    <div class="metric-grid">
      <div class="metric-card">
        <h3>平均响应时间</h3>
        <p>{{performance.avgResponseTime}}ms</p>
    </div>
      <div class="metric-card">
        <h3>错误率</h3>
        <p>{{performance.errorRate}}%</p>
      </div>
      <div class="metric-card">
        <h3>吞吐量</h3>
        <p>{{performance.throughput}}/秒</p>
      </div>
    </div>
    <div class="chart-container">
      <canvas id="performanceChart"></canvas>
    </div>
  </div>

  <div class="section">
    <h2>资源使用情况</h2>
    <div class="chart-container">
      <canvas id="resourceChart"></canvas>
    </div>
  </div>

  <div class="section">
    <h2>错误分析</h2>
    <div class="metric-grid">
      <div class="metric-card">
        <h3>总错误数</h3>
        <p>{{errors.totalCount}}</p>
      </div>
      <div class="metric-card">
        <h3>严重错误</h3>
        <p>{{errors.criticalCount}}</p>
      </div>
      <div class="metric-card">
        <h3>已解决</h3>
        <p>{{errors.resolvedCount}}</p>
      </div>
    </div>
    <div class="chart-container">
      <canvas id="errorChart"></canvas>
    </div>
  </div>

  <div class="section">
    <h2>一致性检查</h2>
    <div class="metric-grid">
      <div class="metric-card">
        <h3>检查总数</h3>
        <p>{{consistency.totalChecks}}</p>
      </div>
      <div class="metric-card">
        <h3>通过率</h3>
        <p>{{consistency.passRate}}%</p>
      </div>
      <div class="metric-card">
        <h3>待处理问题</h3>
        <p>{{consistency.pendingIssues}}</p>
      </div>
    </div>
    <div class="chart-container">
      <canvas id="consistencyChart"></canvas>
    </div>
  </div>

    <script>
            {{chartScripts}}
    </script>
</body>
</html>
`

// 缓存配置
interface CacheConfig {
  ttl: number // 缓存生存时间（毫秒）
  maxSize: number // 最大缓存条目数
}

// 缓存条目
interface CacheEntry<T> {
  data: T
  timestamp: number
  expiresAt: number
}

// 缓存管理器
class CacheManager<T> {
  private cache: Map<string, CacheEntry<T>> = new Map()
  private config: CacheConfig

  constructor(config: CacheConfig) {
    this.config = config
    this.startCleanupInterval()
  }

  set(key: string, data: T): void {
    const now = Date.now()
    this.cache.set(key, {
      data,
      timestamp: now,
      expiresAt: now + this.config.ttl
    })

    // 如果超过最大大小，删除最旧的条目
    if (this.cache.size > this.config.maxSize) {
      const oldestKey = Array.from(this.cache.entries()).sort((a, b) => a[1].timestamp - b[1].timestamp)[0][0]
      this.cache.delete(oldestKey)
    }
  }

  get(key: string): T | null {
    const entry = this.cache.get(key)
    if (!entry) return null
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      return null
    }
    return entry.data
  }

  private startCleanupInterval(): void {
    setInterval(() => {
      const now = Date.now()
      for (const [key, entry] of this.cache.entries()) {
        if (now > entry.expiresAt) {
          this.cache.delete(key)
        }
      }
    }, this.config.ttl)
  }
}

const gzip = promisify(createGzip)
const gunzip = promisify(createGunzip)

interface ExportOptions {
  format: 'html' | 'markdown' | 'json'
  compress?: boolean
  path?: string
}

interface ChartConfig {
  type: 'line' | 'bar' | 'pie' | 'radar'
  title: string
  data: any
  options?: any
}

interface ChartData {
  labels: string[]
  datasets: Array<{
    label: string
    data: number[]
    backgroundColor?: string | string[]
    borderColor?: string | string[]
    fill?: boolean
  }>
}

export class ReportGenerator extends EventEmitter {
  private static instance: ReportGenerator
  private readonly DEFAULT_CONFIG: ReportConfig = {
    title: '系统运行状态报告',
    period: 'day',
    sections: ['performance', 'errors', 'consistency', 'predictions'],
    format: 'html',
    includeCharts: true,
    includeTables: true,
    includeRecommendations: true,
    compression: true
  }

  private dataCache: CacheManager<ReportData>
  private updateInterval: NodeJS.Timeout | null = null
  private mlPredictor: MLPredictor

  private constructor(mlPredictor: MLPredictor) {
    super()
    this.mlPredictor = mlPredictor
    this.dataCache = new CacheManager<ReportData>({
      ttl: 5 * 60 * 1000, // 5分钟缓存
      maxSize: 100
    })
    this.initializeInternalState()
    this.startDataUpdateInterval()
  }

  private startDataUpdateInterval(): void {
    // 每分钟更新一次数据
    this.updateInterval = setInterval(async () => {
      try {
        const data = await this.collectReportData(this.DEFAULT_CONFIG)
        this.dataCache.set('latest', data)
        this.emit('dataUpdated', data)
      } catch (error) {
        this.emit('error', error)
      }
    }, 60 * 1000)
  }

  async generateReport(config: Partial<ReportConfig> = {}): Promise<string> {
    const finalConfig = { ...this.DEFAULT_CONFIG, ...config }

    // 尝试从缓存获取数据
    const cacheKey = this.generateCacheKey(finalConfig)
    let data = this.dataCache.get(cacheKey)

    if (!data) {
      data = await this.collectReportData(finalConfig)
      this.dataCache.set(cacheKey, data)
    }

    switch (finalConfig.format) {
      case 'html':
        return this.generateHtmlReport(data, finalConfig)
      case 'markdown':
        return this.generateMarkdownReport(data, finalConfig)
      case 'json':
        return JSON.stringify(data, null, 2)
      default:
        throw new Error(`不支持的报告格式: ${finalConfig.format}`)
    }
  }

  private generateCacheKey(config: ReportConfig): string {
    return `${config.period}_${config.sections.join('_')}_${config.format}`
  }

  // 添加实时数据订阅机制
  subscribeToUpdates(callback: (data: ReportData) => void): void {
    this.on('dataUpdated', callback)
  }

  unsubscribeFromUpdates(callback: (data: ReportData) => void): void {
    this.off('dataUpdated', callback)
  }

  // 清理资源
  destroy(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval)
      this.updateInterval = null
    }
    this.removeAllListeners()
  }

  private initializeInternalState(): void {
    // 初始化任何必要的内部状态变量
  }

  static getInstance(): ReportGenerator {
    if (!ReportGenerator.instance) {
      ReportGenerator.instance = new ReportGenerator(mlPredictor)
    }
    return ReportGenerator.instance
  }

  private async collectReportData(config: ReportConfig): Promise<ReportData> {
    const now = Date.now()
    let timeRange: { start: number; end: number }

    switch (config.period) {
      case 'hour':
        timeRange = { start: now - 60 * 60 * 1000, end: now }
        break
      case 'day':
        timeRange = { start: now - 24 * 60 * 60 * 1000, end: now }
        break
      case 'week':
        timeRange = { start: now - 7 * 24 * 60 * 60 * 1000, end: now }
        break
      case 'month':
        timeRange = { start: now - 30 * 24 * 60 * 60 * 1000, end: now }
        break
      default:
        throw new Error(`不支持的时间周期: ${config.period}`)
    }

    const [performance, errors, consistency, predictions] = await Promise.all([
      this.collectPerformanceData(timeRange),
      this.collectErrorData(timeRange),
      this.collectConsistencyData(timeRange),
      this.collectPredictionData()
    ])

    return {
      timestamp: new Date(),
      period: config.period,
      performance,
      errors,
      consistency,
      predictions
    }
  }

  private async collectPerformanceData(timeRange: { start: number; end: number }) {
    const stats = performanceMonitor.getAllStats()
    const performanceData = {
      summary: {
        avgResponseTime: 0,
        errorRate: 0,
        throughput: 0,
        resourceUsage: {
          cpu: 0,
          memory: 0
        }
      },
      trends: [] as ReportData['performance']['trends'],
      hotspots: [] as ReportData['performance']['hotspots']
    }

    // 累加所有操作的统计数据
    let totalOperations = 0
    let totalResponseTime = 0
    let totalErrors = 0

    Object.values(stats).forEach((stat) => {
      totalOperations += stat.totalOperations
      totalResponseTime += stat.avgDuration * stat.totalOperations
      totalErrors += stat.errorRate * stat.totalOperations

      if (stat.memoryStats) {
        performanceData.summary.resourceUsage.memory += stat.memoryStats.avgHeapUsed
      }
      if (stat.cpuStats) {
        performanceData.summary.resourceUsage.cpu += stat.cpuStats.avgUserCPU
      }
    })

    performanceData.summary.avgResponseTime = totalResponseTime / totalOperations
    performanceData.summary.errorRate = totalErrors / totalOperations
    performanceData.summary.throughput = totalOperations / ((timeRange.end - timeRange.start) / 1000)

    // 分析性能趋势
    const timestamps = this.generateTimestamps(new Date(timeRange.start), new Date(timeRange.end))
    performanceData.trends = [
      {
        metric: '响应时间',
        values: this.calculatePerformanceTrend(stats, timestamps, 'avgDuration'),
        timestamps
      },
      {
        metric: '错误率',
        values: this.calculatePerformanceTrend(stats, timestamps, 'errorRate'),
        timestamps
      },
      {
        metric: '内存使用',
        values: this.calculatePerformanceTrend(stats, timestamps, 'memoryUsage'),
        timestamps
      }
    ]

    // 找出响应时间过长的操作
    Object.entries(stats).forEach(([operation, stat]) => {
      // 检查平均响应时间
      if (stat.avgDuration > performanceData.summary.avgResponseTime * 2) {
        performanceData.hotspots.push({
          operation,
          metric: 'response_time',
          value: stat.avgDuration,
          threshold: performanceData.summary.avgResponseTime * 2
        })
      }

      // 检查最大响应时间
      if (stat.maxDuration > performanceData.summary.avgResponseTime * 5) {
        performanceData.hotspots.push({
          operation,
          metric: 'max_response_time',
          value: stat.maxDuration,
          threshold: performanceData.summary.avgResponseTime * 5
        })
      }

      // 检查错误率
      if (stat.errorRate > 0.1) {
        performanceData.hotspots.push({
          operation,
          metric: 'error_rate',
          value: stat.errorRate,
          threshold: 0.1
        })
      }

      // 检查内存使用
      if (stat.memoryStats && stat.memoryStats.maxHeapUsed > 1024 * 1024 * 1024) {
        // 1GB
        performanceData.hotspots.push({
          operation,
          metric: 'memory_usage',
          value: stat.memoryStats.maxHeapUsed,
          threshold: 1024 * 1024 * 1024
        })
      }
    })

    return performanceData
  }

  private calculatePerformanceTrend(stats: Record<string, any>, timestamps: number[], metric: string): number[] {
    const trend: number[] = []

    for (let i = 0; i < timestamps.length - 1; i++) {
      let value = 0
      let count = 0

      Object.values(stats).forEach((stat: any) => {
        if (stat.lastHourStats && stat.lastHourStats[metric]) {
          value += stat.lastHourStats[metric]
          count++
        }
      })

      trend.push(count > 0 ? value / count : 0)
    }

    return trend
  }

  private async collectErrorData(timeRange: { start: number; end: number }) {
    const stats = errorAnalyzer.getErrorStats(timeRange)
    const resolvedCount = await this.getResolvedErrorCount(timeRange)
    const timeDistribution = await this.getErrorTimeDistribution(timeRange)

    return {
      summary: {
        totalCount: stats.totalErrors,
        uniqueTypes: Object.keys(stats.categoryDistribution).length,
        criticalCount: stats.severityDistribution.high || 0,
        resolvedCount
      },
      distribution: {
        byCategory: stats.categoryDistribution,
        bySeverity: stats.severityDistribution,
        byTime: timeDistribution
      },
      topIssues: stats.mostFrequentErrors.map((error) => ({
        type: error.type,
        count: error.count,
        trend: error.trend,
        impact: this.calculateErrorImpact(error)
      }))
    }
  }

  private async getResolvedErrorCount(timeRange: { start: number; end: number }): Promise<number> {
    const startDate = new Date(timeRange.start)
    const endDate = new Date(timeRange.end)

    const result = await prisma.consistencyIssue.count({
      where: {
        timestamp: {
          gte: startDate,
          lte: endDate
        },
        status: 'fixed'
      }
    })
    return result
  }

  private async getErrorTimeDistribution(timeRange: { start: number; end: number }): Promise<
    Array<{
      timestamp: number
      count: number
    }>
  > {
    const startDate = new Date(timeRange.start)
    const endDate = new Date(timeRange.end)
    const timestamps = this.generateTimestamps(startDate, endDate)
    const distribution: Array<{ timestamp: number; count: number }> = []

    for (let i = 0; i < timestamps.length - 1; i++) {
      const periodStart = new Date(timestamps[i])
      const periodEnd = new Date(timestamps[i + 1])

      const count = await prisma.consistencyIssue.count({
        where: {
          timestamp: {
            gte: periodStart,
            lt: periodEnd
          }
        }
      })

      distribution.push({
        timestamp: timestamps[i],
        count
      })
    }

    return distribution
  }

  private async collectConsistencyData(timeRange: { start: number; end: number }) {
    const startDate = new Date(timeRange.start)
    const endDate = new Date(timeRange.end)

    const filteredSummary = {
      totalChecks: await this.getConsistencyChecksCount(startDate, endDate),
      passedChecks: await this.getPassedChecksCount(startDate, endDate),
      failedChecks: await this.getFailedChecksCount(startDate, endDate),
      fixedIssues: await this.getFixedIssuesCount(startDate, endDate)
    }

    return {
      summary: filteredSummary,
      issues: await this.getConsistencyIssues(startDate, endDate),
      trends: [
        {
          metric: '一致性趋势',
          values: await this.getConsistencyTrends(startDate, endDate),
          timestamps: this.generateTimestamps(startDate, endDate)
        }
      ]
    }
  }

  private async getConsistencyChecksCount(start: Date, end: Date): Promise<number> {
    const result = await prisma.consistencyCheck.count({
      where: {
        timestamp: {
          gte: start,
          lte: end
        }
      }
    })
    return result
  }

  private async getPassedChecksCount(start: Date, end: Date): Promise<number> {
    const result = await prisma.consistencyCheck.count({
      where: {
        timestamp: {
          gte: start,
          lte: end
        },
        status: 'passed'
      }
    })
    return result
  }

  private async getFailedChecksCount(start: Date, end: Date): Promise<number> {
    const result = await prisma.consistencyCheck.count({
      where: {
        timestamp: {
          gte: start,
          lte: end
        },
        status: 'failed'
      }
    })
    return result
  }

  private async getFixedIssuesCount(start: Date, end: Date): Promise<number> {
    const result = await prisma.consistencyIssue.count({
      where: {
        timestamp: {
          gte: start,
          lte: end
        },
        status: 'fixed'
      }
    })
    return result
  }

  private async getConsistencyIssues(start: Date, end: Date): Promise<ReportData['consistency']['issues']> {
    const issues = await prisma.consistencyIssue.findMany({
      where: {
        timestamp: {
          gte: start,
          lte: end
        }
      },
      select: {
        type: true,
        severity: true,
        status: true
      },
      orderBy: {
        timestamp: 'desc'
      }
    })

    // 按类型分组并计数
    const issueGroups = issues.reduce(
      (acc, issue) => {
        const key = issue.type
        if (!acc[key]) {
          acc[key] = {
            type: issue.type,
            count: 0,
            severity: issue.severity,
            status: issue.status
          }
        }
        acc[key].count++
        return acc
      },
      {} as Record<string, { type: string; count: number; severity: string; status: string }>
    )

    return Object.values(issueGroups)
  }

  private async getConsistencyTrends(start: Date, end: Date): Promise<number[]> {
    const timestamps = this.generateTimestamps(start, end)
    const trends: number[] = []

    for (let i = 0; i < timestamps.length - 1; i++) {
      const periodStart = new Date(timestamps[i])
      const periodEnd = new Date(timestamps[i + 1])

      const issueCount = await prisma.consistencyIssue.count({
        where: {
          timestamp: {
            gte: periodStart,
            lt: periodEnd
          }
        }
      })

      trends.push(issueCount)
    }

    return trends
  }

  private generateTimestamps(start: Date, end: Date): number[] {
    const timestamps: number[] = []
    let current = start.getTime()
    const endTime = end.getTime()
    const interval = Math.floor((endTime - current) / 10) // 生成时间戳的逻辑

    while (current <= endTime) {
      timestamps.push(current)
      current += interval
    }

    return timestamps
  }

  private async collectPredictionData() {
    const predictions = mlPredictor.getPredictions()
    const modelStatus = mlPredictor.getModelStatus()

    return {
      summary: {
        totalPredictions: predictions.length,
        highPriority: predictions.filter((p) => p.impact.severity === 'high').length,
        accuracy:
          Object.values(modelStatus).reduce((acc, status) => acc + (status.accuracy || 0), 0) /
          Object.keys(modelStatus).length
      },
      upcoming: predictions.map((p) => ({
        type: p.type,
        probability: p.probability,
        timeFrame: p.timeFrame,
        impact: `${p.impact.severity} (${p.impact.scope.join(', ')})`
      })),
      preventiveActions: this.generatePreventiveActions(predictions)
    }
  }

  private generateChartScript(config: ChartConfig): string {
    const chartId = `chart_${Math.random().toString(36).substr(2, 9)}`
    return `
      const ctx_${chartId} = document.getElementById('${chartId}').getContext('2d');
      new Chart(ctx_${chartId}, {
        type: '${config.type}',
        data: ${JSON.stringify(config.data)},
        options: ${JSON.stringify(config.options || {})}
      });
    `
  }

  private generatePerformanceCharts(data: ReportData): string {
    const charts: string[] = []

    // 响应时间趋势图
    const responseTimeData: ChartData = {
      labels:
        data.performance.trends
          .find((t) => t.metric === 'responseTime')
          ?.timestamps.map((t) => new Date(t).toLocaleTimeString()) || [],
      datasets: [
        {
          label: '响应时间 (ms)',
          data: data.performance.trends.find((t) => t.metric === 'responseTime')?.values || [],
          borderColor: '#1a73e8',
          fill: false
        }
      ]
    }

    charts.push(
      this.generateChartScript({
            type: 'line',
        title: '响应时间趋势',
        data: responseTimeData,
            options: {
                scales: {
            y: {
              beginAtZero: true
            }
          }
        }
      })
    )

    // 资源使用饼图
    const resourceData: ChartData = {
      labels: ['CPU使用率', '内存使用率'],
      datasets: [
        {
          data: [data.performance.summary.resourceUsage.cpu, data.performance.summary.resourceUsage.memory],
          backgroundColor: ['#34a853', '#fbbc05']
        }
      ]
    }

    charts.push(
      this.generateChartScript({
        type: 'pie',
        title: '资源使用情况',
        data: resourceData
      })
    )

    return charts.join('\n')
  }

  private generateErrorCharts(data: ReportData): string {
    const charts: string[] = []

    // 错误分布柱状图
    const errorDistData: ChartData = {
      labels: Object.keys(data.errors.distribution.byCategory),
      datasets: [
        {
          label: '错误数量',
          data: Object.values(data.errors.distribution.byCategory),
          backgroundColor: '#ea4335'
        }
      ]
    }

    charts.push(
      this.generateChartScript({
        type: 'bar',
        title: '错误分布',
        data: errorDistData
      })
    )

    // 错误趋势折线图
    const errorTrendData: ChartData = {
      labels: data.errors.distribution.byTime.map((t) => new Date(t.timestamp).toLocaleTimeString()),
      datasets: [
        {
          label: '错误数量',
          data: data.errors.distribution.byTime.map((t) => t.count),
          borderColor: '#ea4335',
          fill: false
        }
      ]
    }

    charts.push(
      this.generateChartScript({
        type: 'line',
        title: '错误趋势',
        data: errorTrendData
      })
    )

    return charts.join('\n')
  }

  private generateConsistencyCharts(data: ReportData): string {
    const charts: string[] = []

    // 一致性检查雷达图
    const consistencyData: ChartData = {
      labels: ['通过检查', '失败检查', '已修复问题', '待处理问题'],
      datasets: [
        {
          label: '一致性状态',
                    data: [
            data.consistency.summary.passedChecks,
            data.consistency.summary.failedChecks,
            data.consistency.summary.fixedIssues,
            data.consistency.issues.length
                    ],
                    backgroundColor: 'rgba(26, 115, 232, 0.2)',
          borderColor: '#1a73e8'
        }
      ]
    }

    charts.push(
      this.generateChartScript({
        type: 'radar',
        title: '一致性检查状态',
        data: consistencyData
      })
    )

    return charts.join('\n')
  }

  private generatePredictionCharts(data: ReportData): string {
    const charts: string[] = []

    // 预测准确度仪表图
    const accuracyData: ChartData = {
      labels: ['准确度'],
      datasets: [
        {
          data: [data.predictions.summary.accuracy * 100],
          backgroundColor: '#34a853'
        }
      ]
    }

    charts.push(
      this.generateChartScript({
        type: 'pie',
        title: '预测准确度',
        data: accuracyData,
        options: {
          circumference: 180,
          rotation: -90,
          plugins: {
            legend: {
              display: false
            }
          }
        }
      })
    )

    return charts.join('\n')
  }

  private async generateHtmlReport(data: ReportData, config: ReportConfig): Promise<string> {
    let template = HTML_TEMPLATE
    let chartScripts = ''

    if (config.includeCharts) {
      chartScripts = [
        this.generatePerformanceCharts(data),
        this.generateErrorCharts(data),
        this.generateConsistencyCharts(data),
        this.generatePredictionCharts(data)
      ].join('\n')
    }

    // 替换模板变量
    template = template.replace('{{chartScripts}}', chartScripts)
    return await this.generateCustomReport(data, template, config)
  }

  private generateMarkdownReport(data: ReportData, config: ReportConfig): string {
    let report = `# ${config.title}\n\n`
    report += `生成时间: ${data.timestamp.toLocaleString()}\n`
    report += `统计周期: ${this.formatPeriod(data.period)}\n\n`

    if (config.sections.includes('performance')) {
      report += this.generatePerformanceSection(data.performance)
    }

    if (config.sections.includes('errors')) {
      report += this.generateErrorSection(data.errors)
    }

    if (config.sections.includes('consistency')) {
      report += this.generateConsistencySection(data.consistency)
    }

    if (config.sections.includes('predictions')) {
      report += this.generatePredictionSection(data.predictions)
    }

    return report
  }

  private generatePerformanceSection(data: ReportData['performance']): string {
    return `
## 系统性能分析

### 系统性能指标
- 平均响应时间: ${data.summary.avgResponseTime.toFixed(2)}ms
- 错误率: ${(data.summary.errorRate * 100).toFixed(2)}%
- 吞吐量: ${data.summary.throughput.toFixed(2)} ops/s
- 资源使用情况:
  - CPU: ${(data.summary.resourceUsage.cpu * 100).toFixed(2)}%
  - 内存使用情况: ${(data.summary.resourceUsage.memory / 1024 / 1024).toFixed(2)}MB

### 性能瓶颈
${data.hotspots.map((hotspot) => `- ${hotspot.operation}: ${hotspot.metric} = ${hotspot.value}`).join('\n')}

`
  }

  private generateErrorSection(data: ReportData['errors']): string {
    return `
## 错误分析

### 错误分布
- 总错误数: ${data.summary.totalCount}
- 错误类型数: ${data.summary.uniqueTypes}
- 严重错误数: ${data.summary.criticalCount}
- 已解决错误数: ${data.summary.resolvedCount}

### 错误类型分布
${Object.entries(data.distribution.byCategory)
  .map(([type, count]) => `- ${type}: ${count}`)
  .join('\n')}

`
  }

  private generateConsistencySection(data: ReportData['consistency']): string {
    return `
## 一致性分析

### 一致性检查结果
- 总检查数: ${data.summary.totalChecks}
- 已通过检查数: ${data.summary.passedChecks}
- 未通过检查数: ${data.summary.failedChecks}
- 已修复问题数: ${data.summary.fixedIssues}

### 问题分析
${data.issues.map((issue) => `- ${issue.type}: ${issue.count} (${issue.severity})`).join('\n')}

`
  }

  private generatePredictionSection(data: ReportData['predictions']): string {
    return `
## 错误预测分析

### 错误预测结果
- 总预测数: ${data.summary.totalPredictions}
- 高优先级错误数: ${data.summary.highPriority}
- 错误预测准确率: ${(data.summary.accuracy * 100).toFixed(2)}%

### 高优先级错误预测
${data.upcoming.map((pred) => `- ${pred.type}: ${(pred.probability * 100).toFixed(2)}% 高优先级错误`).join('\n')}

### 预防措施
${data.preventiveActions.map((action) => `- ${action.action} (${action.priority})`).join('\n')}

`
  }

  private getTimeRange(period: ReportConfig['period']): { start: number; end: number } {
    const end = Date.now()
    let start: number

    switch (period) {
      case 'hour':
        start = end - 60 * 60 * 1000
        break
      case 'day':
        start = end - 24 * 60 * 60 * 1000
        break
      case 'week':
        start = end - 7 * 24 * 60 * 60 * 1000
        break
      case 'month':
        start = end - 30 * 24 * 60 * 60 * 1000
        break
      default:
        throw new Error(`不支持的时间周期: ${period}`)
    }

    return { start, end }
  }

  private formatPeriod(period: ReportConfig['period']): string {
    const periodMap = {
      hour: '1小时',
      day: '24小时',
      week: '7天',
      month: '30天'
    }
    return periodMap[period]
  }

  private calculateErrorImpact(error: any): string {
    // 实现计算错误影响逻辑
    if (!error) return 'low'

    const severity = error.severity || 'low'
    const count = error.count || 0
    const trend = error.trend || 'stable'

    if (severity === 'high' || count > 100 || trend === 'increasing') {
      return 'high'
    } else if (severity === 'medium' || count > 50) {
      return 'medium'
    }
    return 'low'
  }

  private generatePreventiveActions(predictions: any[]): ReportData['predictions']['preventiveActions'] {
    if (!predictions || predictions.length === 0) return []

    return predictions
      .filter((p) => p.probability > 0.7)
      .map((p) => ({
        action: `预防措施 ${p.type} 优先级 ${this.getStatusClass(p.impact.severity)}`,
        priority: this.getStatusClass(p.impact.severity),
        deadline: new Date(p.timeFrame.start)
      }))
  }

  async exportReport(options: ExportOptions): Promise<string> {
    const report = await this.generateReport({ format: options.format })
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `report_${timestamp}.${options.format}`
    const outputPath = options.path || join(process.cwd(), 'reports')
    const fullPath = join(outputPath, filename)

    if (options.compress) {
      const compressed = await gzip(Buffer.from(report))
      await writeFile(`${fullPath}.gz`, compressed)
      return `${fullPath}.gz`
    } else {
      await writeFile(fullPath, report)
      return fullPath
    }
  }

  private async compressData(data: string): Promise<Buffer> {
    return await gzip(Buffer.from(data))
  }

  private async decompressData(compressed: Buffer): Promise<string> {
    const buffer = await gunzip(compressed)
    return buffer.toString()
  }

  private async generateCompressedReport(data: ReportData, config: ReportConfig): Promise<Buffer> {
    const report = await this.generateReport(config)
    return await this.compressData(report)
  }

  // 添加批量导出功能
  async exportReports(configs: ReportConfig[], options: ExportOptions): Promise<string[]> {
    const paths: string[] = []
    for (const config of configs) {
      const path = await this.exportReport({
        ...options,
        format: config.format
      })
      paths.push(path)
    }
    return paths
  }

  // 添加自定义报告模板支持
  private async generateCustomReport(data: ReportData, template: string, config: ReportConfig): Promise<string> {
    let report = template

    if (config.includeCharts) {
      // 格式化性能数据
      const performanceData = this.formatChartData(
        {
          timestamps: data.performance.trends[0].timestamps,
          values: data.performance.trends[0].values
        },
        'performance'
      )

      // 格式化资源使用数据
      const resourceData = this.formatChartData(
        {
          cpu: data.performance.summary.resourceUsage.cpu,
          memory: data.performance.summary.resourceUsage.memory,
          disk: data.performance.summary.resourceUsage.disk,
          network: data.performance.summary.resourceUsage.network
        },
        'resource'
      )

      // 格式化错误数据
      const errorData = this.formatChartData(data.errors.distribution.byCategory, 'error')

      // 格式化一致性数据
      const consistencyData = this.formatChartData(
        {
          passed: data.consistency.summary.passedChecks,
          failed: data.consistency.summary.failedChecks,
          fixed: data.consistency.summary.fixedIssues,
          pending: data.consistency.issues.length
        },
        'consistency'
      )

      // 替换图表数据
      report = report
        .replace('{{performanceData}}', JSON.stringify(performanceData))
        .replace('{{resourceData}}', JSON.stringify(resourceData))
        .replace('{{errorData}}', JSON.stringify(errorData))
        .replace('{{consistencyData}}', JSON.stringify(consistencyData))
    }

    // 替换基本信息
    report = report
      .replace('{{title}}', config.title)
      .replace('{{timestamp}}', data.timestamp.toLocaleString('zh-CN'))
      .replace('{{period}}', data.period)

    // 替换性能指标
    if (config.sections.includes('performance')) {
      report = report
        .replace('{{performance.avgResponseTime}}', data.performance.summary.avgResponseTime.toFixed(2))
        .replace('{{performance.errorRate}}', (data.performance.summary.errorRate * 100).toFixed(2))
        .replace('{{performance.throughput}}', data.performance.summary.throughput.toString())
    }

    // 替换错误指标
    if (config.sections.includes('errors')) {
      report = report
        .replace('{{errors.totalCount}}', data.errors.summary.totalCount.toString())
        .replace('{{errors.criticalCount}}', data.errors.summary.criticalCount.toString())
        .replace('{{errors.resolvedCount}}', data.errors.summary.resolvedCount.toString())
    }

    // 替换一致性指标
    if (config.sections.includes('consistency')) {
      const passRate = ((data.consistency.summary.passedChecks / data.consistency.summary.totalChecks) * 100).toFixed(2)
      report = report
        .replace('{{consistency.totalChecks}}', data.consistency.summary.totalChecks.toString())
        .replace('{{consistency.passRate}}', passRate)
        .replace('{{consistency.pendingIssues}}', data.consistency.issues.length.toString())
    }

    return report
  }

  // 添加数据压缩功能到缓存管理器
  private async cacheCompressedData(key: string, data: any): Promise<void> {
    const compressed = await this.compressData(JSON.stringify(data))
    this.dataCache.set(key, compressed)
  }

  private async getCachedCompressedData(key: string): Promise<any | null> {
    const compressed = this.dataCache.get(key)
    if (!compressed) return null
    return await this.decompressData(compressed)
  }

  private formatChartData(data: any, type: string): ChartData {
    switch (type) {
      case 'performance':
        return {
          labels: data.timestamps.map((t: string) => new Date(t).toLocaleTimeString()),
          datasets: [
            {
              label: '响应时间 (ms)',
              data: data.values,
              borderColor: '#1a73e8',
              fill: false
            }
          ]
        }
      case 'resource':
        return {
          labels: ['CPU使用率', '内存使用率', '磁盘使用率', '网络带宽'],
          datasets: [
            {
              label: '资源使用情况',
              data: [data.cpu * 100, data.memory * 100, data.disk * 100, data.network * 100],
              backgroundColor: ['#34a853', '#fbbc05', '#ea4335', '#1a73e8']
            }
          ]
        }
      case 'error':
        return {
          labels: Object.keys(data),
          datasets: [
            {
              label: '错误数量',
              data: Object.values(data),
              backgroundColor: '#ea4335'
            }
          ]
        }
      case 'consistency':
        return {
          labels: ['通过', '失败', '修复', '待处理'],
          datasets: [
            {
              label: '一致性状态',
              data: [data.passed, data.failed, data.fixed, data.pending],
              backgroundColor: 'rgba(26, 115, 232, 0.2)',
              borderColor: '#1a73e8'
            }
          ]
        }
      default:
        return {
          labels: [],
          datasets: []
        }
    }
  }

  private getStatusClass(status: string): string {
    switch (status.toLowerCase()) {
      case 'high':
      case 'critical':
        return 'error'
      case 'medium':
      case 'warning':
        return 'warning'
      default:
        return 'success'
    }
  }
}

export const reportGenerator = ReportGenerator.getInstance()
