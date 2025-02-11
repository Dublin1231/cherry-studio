interface PerformanceMetrics {
  operationName: string
  duration: number
  timestamp: number
  success: boolean
  error?: string
  metadata?: Record<string, any>
  memoryUsage?: {
    heapUsed: number
    heapTotal: number
    external: number
    arrayBuffers: number
  }
  cpuUsage?: {
    user: number
    system: number
  }
}

interface PerformanceStats {
  avgDuration: number
  maxDuration: number
  minDuration: number
  successRate: number
  errorRate: number
  totalOperations: number
  lastHourStats: {
    avgDuration: number
    successRate: number
    operationCount: number
  }
  memoryStats?: {
    avgHeapUsed: number
    maxHeapUsed: number
    avgHeapTotal: number
  }
  cpuStats?: {
    avgUserCPU: number
    avgSystemCPU: number
  }
}

interface PerformanceAlert {
  type: 'error_rate' | 'duration' | 'memory' | 'cpu'
  level: 'warning' | 'critical'
  message: string
  timestamp: number
  metadata?: Record<string, any>
}

interface OperationMetrics {
  startTime: number
  endTime: number
  duration: number
  success: boolean
  error?: Error
  memoryUsage?: {
    heapUsed: number
    heapTotal: number
  }
  cpuUsage?: {
    user: number
    system: number
  }
}

export class PerformanceMonitor {
  private static instance: PerformanceMonitor
  private metrics: Map<string, OperationMetrics[]> = new Map()
  private alerts: PerformanceAlert[] = []
  private readonly MAX_METRICS_LENGTH = 1000
  private readonly MAX_ALERTS_LENGTH = 100
  private readonly ALERT_THRESHOLDS = {
    errorRate: { warning: 0.1, critical: 0.2 },
    duration: { warning: 1000, critical: 2000 },
    memoryUsage: { warning: 0.8, critical: 0.9 },
    cpuUsage: { warning: 0.7, critical: 0.85 }
  }

  private constructor() {
    // 定期清理旧的性能指标数据
    setInterval(() => this.cleanOldMetrics(), 24 * 60 * 60 * 1000)
    setInterval(() => this.analyzePerformanceTrends(), 60 * 60 * 1000) // 每小时分析性能趋势
  }

  static getInstance(): PerformanceMonitor {
    if (!PerformanceMonitor.instance) {
      PerformanceMonitor.instance = new PerformanceMonitor()
    }
    return PerformanceMonitor.instance
  }

  // 开始监控操作性能
  startOperation(operationName: string, metadata?: Record<string, any>): () => void {
    const startTime = Date.now()
    const startMemory = process.memoryUsage()
    const startCPU = process.cpuUsage()

    const metrics: Partial<OperationMetrics> = {
      startTime,
      success: false
    }

    if (!this.metrics.has(operationName)) {
      this.metrics.set(operationName, [])
    }
    this.metrics.get(operationName)!.push(metrics as OperationMetrics)

    return () => {
      const endTime = Date.now()
      const endMemory = process.memoryUsage()
      const endCPU = process.cpuUsage(startCPU)

      Object.assign(metrics, {
        endTime,
        duration: endTime - startTime,
        success: true,
        memoryUsage: {
          heapUsed: endMemory.heapUsed - startMemory.heapUsed,
          heapTotal: endMemory.heapTotal - startMemory.heapTotal
        },
        cpuUsage: {
          user: endCPU.user,
          system: endCPU.system
        }
      })

      this.checkPerformanceThresholds({
        operationName,
        duration: endTime - startTime,
        memoryUsage: endMemory,
        cpuUsage: endCPU
      })
    }
  }

  // 记录错误信息
  recordError(operationName: string, error: Error, metadata?: Record<string, any>): void {
    const metrics: PerformanceMetrics = {
      operationName,
      duration: 0,
      timestamp: Date.now(),
      success: false,
      error: error.message,
      metadata,
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage()
    }

    this.recordMetric(metrics)
    this.checkErrorThresholds(operationName)
  }

  // 获取指定操作的性能统计数据
  getOperationStats(operationName: string, timeRange?: { start: number; end: number }): PerformanceStats {
    let operationMetrics = this.getMetrics(operationName)

    if (timeRange) {
      operationMetrics = operationMetrics.filter((m) => m.startTime >= timeRange.start && m.endTime <= timeRange.end)
    }

    if (operationMetrics.length === 0) {
      return this.getEmptyStats()
    }

    const durations = operationMetrics.map((m) => m.duration)
    const successCount = operationMetrics.filter((m) => m.success).length
    const lastHourMetrics = this.getLastHourMetrics(operationMetrics)

    const memoryStats = this.calculateMemoryStats(operationMetrics)
    const cpuStats = this.calculateCPUStats(operationMetrics)

    return {
      avgDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
      maxDuration: Math.max(...durations),
      minDuration: Math.min(...durations),
      successRate: successCount / operationMetrics.length,
      errorRate: (operationMetrics.length - successCount) / operationMetrics.length,
      totalOperations: operationMetrics.length,
      lastHourStats: {
        avgDuration: lastHourMetrics.avgDuration,
        successRate: lastHourMetrics.successRate,
        operationCount: lastHourMetrics.count
      },
      memoryStats,
      cpuStats
    }
  }

  // 获取所有操作的性能统计数据
  getAllStats(): Record<string, PerformanceStats> {
    const operations = new Set(this.metrics.keys())
    const stats: Record<string, PerformanceStats> = {}

    for (const operation of operations) {
      stats[operation] = this.getOperationStats(operation)
    }

    return stats
  }

  // 获取性能警告信息
  getPerformanceWarnings(): Array<{
    operation: string
    warning: string
    level: 'warning' | 'critical'
  }> {
    const warnings: Array<{
      operation: string
      warning: string
      level: 'warning' | 'critical'
    }> = []
    const stats = this.getAllStats()

    for (const [operation, stat] of Object.entries(stats)) {
      if (stat.errorRate > 0.1) {
        warnings.push({
          operation,
          warning: `错误率过高: ${(stat.errorRate * 100).toFixed(2)}%`,
          level: stat.errorRate > 0.2 ? 'critical' : 'warning'
        })
      }

      if (stat.avgDuration > 1000) {
        warnings.push({
          operation,
          warning: `平均执行时间过长: ${stat.avgDuration.toFixed(2)}ms`,
          level: stat.avgDuration > 2000 ? 'critical' : 'warning'
        })
      }
    }

    return warnings
  }

  getPerformanceAlerts(timeRange?: { start: number; end: number }): PerformanceAlert[] {
    if (!timeRange) {
      return this.alerts
    }
    return this.alerts.filter((a) => a.timestamp >= timeRange.start && a.timestamp <= timeRange.end)
  }

  private getEmptyStats(): PerformanceStats {
    return {
      avgDuration: 0,
      maxDuration: 0,
      minDuration: 0,
      successRate: 0,
      errorRate: 0,
      totalOperations: 0,
      lastHourStats: {
        avgDuration: 0,
        successRate: 0,
        operationCount: 0
      }
    }
  }

  private getLastHourMetrics(metrics: OperationMetrics[]): { avgDuration: number; successRate: number; count: number } {
    const hourAgo = Date.now() - 60 * 60 * 1000
    const recentMetrics = metrics.filter((m) => m.startTime >= hourAgo)

    if (recentMetrics.length === 0) {
      return { avgDuration: 0, successRate: 0, count: 0 }
    }

    const durations = recentMetrics.map((m) => m.duration)
    const successCount = recentMetrics.filter((m) => m.success).length

    return {
      avgDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
      successRate: successCount / recentMetrics.length,
      count: recentMetrics.length
    }
  }

  private calculateMemoryStats(
    metrics: OperationMetrics[]
  ): { avgHeapUsed: number; maxHeapUsed: number; avgHeapTotal: number } | undefined {
    const memoryMetrics = metrics.filter((m) => m.memoryUsage)
    if (memoryMetrics.length === 0) return undefined

    const heapUsed = memoryMetrics.map((m) => m.memoryUsage!.heapUsed)
    const heapTotal = memoryMetrics.map((m) => m.memoryUsage!.heapTotal)

    return {
      avgHeapUsed: heapUsed.reduce((a, b) => a + b, 0) / heapUsed.length,
      maxHeapUsed: Math.max(...heapUsed),
      avgHeapTotal: heapTotal.reduce((a, b) => a + b, 0) / heapTotal.length
    }
  }

  private calculateCPUStats(metrics: OperationMetrics[]): { avgUserCPU: number; avgSystemCPU: number } | undefined {
    const cpuMetrics = metrics.filter((m) => m.cpuUsage)
    if (cpuMetrics.length === 0) return undefined

    const userCPU = cpuMetrics.map((m) => m.cpuUsage!.user)
    const systemCPU = cpuMetrics.map((m) => m.cpuUsage!.system)

    return {
      avgUserCPU: userCPU.reduce((a, b) => a + b, 0) / userCPU.length,
      avgSystemCPU: systemCPU.reduce((a, b) => a + b, 0) / systemCPU.length
    }
  }

  private checkPerformanceThresholds(metrics: {
    operationName: string
    duration: number
    memoryUsage: NodeJS.MemoryUsage
    cpuUsage: NodeJS.CpuUsage
  }) {
    // 检查执行时间
    if (metrics.duration > this.ALERT_THRESHOLDS.duration.critical) {
      this.addAlert({
        type: 'duration',
        level: 'critical',
        message: `操作 ${metrics.operationName} 执行时间过长: ${metrics.duration}ms`,
        timestamp: Date.now()
      })
    } else if (metrics.duration > this.ALERT_THRESHOLDS.duration.warning) {
      this.addAlert({
        type: 'duration',
        level: 'warning',
        message: `操作 ${metrics.operationName} 执行时间较长: ${metrics.duration}ms`,
        timestamp: Date.now()
      })
    }

    // 检查内存使用
    const memoryUsageRatio = metrics.memoryUsage.heapUsed / metrics.memoryUsage.heapTotal
    if (memoryUsageRatio > this.ALERT_THRESHOLDS.memoryUsage.critical) {
      this.addAlert({
        type: 'memory',
        level: 'critical',
        message: `操作 ${metrics.operationName} 内存使用率过高: ${(memoryUsageRatio * 100).toFixed(2)}%`,
        timestamp: Date.now()
      })
    }
  }

  private checkErrorThresholds(operationName: string) {
    const stats = this.getOperationStats(operationName)
    if (stats.errorRate > this.ALERT_THRESHOLDS.errorRate.critical) {
      this.addAlert({
        type: 'error_rate',
        level: 'critical',
        message: `操作 ${operationName} 的错误率达到临界值: ${(stats.errorRate * 100).toFixed(2)}%`,
        timestamp: Date.now()
      })
    } else if (stats.errorRate > this.ALERT_THRESHOLDS.errorRate.warning) {
      this.addAlert({
        type: 'error_rate',
        level: 'warning',
        message: `操作 ${operationName} 的错误率较高: ${(stats.errorRate * 100).toFixed(2)}%`,
        timestamp: Date.now()
      })
    }
  }

  // 分析性能趋势
  private analyzePerformanceTrends(): void {
    const stats = this.getAllStats()
    for (const [operation, currentStats] of Object.entries(stats)) {
      this.checkTrendAlerts(operation, currentStats)
      this.checkErrorThresholds(operation)
    }
  }

  private addAlert(alert: PerformanceAlert) {
    this.alerts.push(alert)
    if (this.alerts.length > this.MAX_ALERTS_LENGTH) {
      this.alerts.shift()
    }
  }

  private recordMetric(metric: PerformanceMetrics): void {
    // Implementation of recordMetric method
  }

  private cleanOldMetrics(): void {
    const now = Date.now()
    const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000
    this.metrics.forEach((operationMetrics, operationName) => {
      this.metrics.set(
        operationName,
        operationMetrics.filter((m) => m.startTime > oneWeekAgo)
      )
    })
    this.alerts = this.alerts.filter((a) => a.timestamp > oneWeekAgo)
  }

  private checkTrendAlerts(operation: string, stats: PerformanceStats): void {
    if (stats.errorRate > this.ALERT_THRESHOLDS.errorRate.critical) {
      this.addAlert({
        type: 'error_rate',
        level: 'critical',
        message: `操作 ${operation} 的错误率达到临界值: ${(stats.errorRate * 100).toFixed(2)}%`,
        timestamp: Date.now()
      })
    } else if (stats.errorRate > this.ALERT_THRESHOLDS.errorRate.warning) {
      this.addAlert({
        type: 'error_rate',
        level: 'warning',
        message: `操作 ${operation} 的错误率较高: ${(stats.errorRate * 100).toFixed(2)}%`,
        timestamp: Date.now()
      })
    }
  }

  getMetrics(operationName: string): OperationMetrics[] {
    return this.metrics.get(operationName) || []
  }

  clearMetrics(operationName?: string) {
    if (operationName) {
      this.metrics.delete(operationName)
    } else {
      this.metrics.clear()
    }
  }
}

export const performanceMonitor = PerformanceMonitor.getInstance()
