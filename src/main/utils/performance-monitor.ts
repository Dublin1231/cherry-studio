import { EventEmitter } from 'events'

interface PerformanceMetric {
  count: number
  totalTime: number
  minTime: number
  maxTime: number
  avgTime: number
  lastTime: number
}

interface PerformanceSnapshot {
  timestamp: number
  metrics: Record<string, PerformanceMetric>
  memory: {
    heapUsed: number
    heapTotal: number
    external: number
    arrayBuffers: number
  }
  cpu: {
    user: number
    system: number
  }
}

export class PerformanceMonitor extends EventEmitter {
  private metrics: Map<string, PerformanceMetric>
  private snapshots: PerformanceSnapshot[]
  private snapshotInterval: NodeJS.Timeout
  private readonly MAX_SNAPSHOTS = 1000

  constructor() {
    super()
    this.metrics = new Map()
    this.snapshots = []
    this.snapshotInterval = setInterval(() => this.takeSnapshot(), 60000) // 每分钟记录一次快照
  }

  startTimer(name: string): () => void {
    const startTime = process.hrtime()

    return () => {
      const [seconds, nanoseconds] = process.hrtime(startTime)
      const duration = seconds * 1000 + nanoseconds / 1000000 // 转换为毫秒
      this.recordMetric(name, duration)
    }
  }

  async measure<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const startTime = process.hrtime()
    try {
      return await fn()
    } finally {
      const [seconds, nanoseconds] = process.hrtime(startTime)
      const duration = seconds * 1000 + nanoseconds / 1000000
      this.recordMetric(name, duration)
    }
  }

  recordMetric(name: string, duration: number): void {
    let metric = this.metrics.get(name)

    if (!metric) {
      metric = {
        count: 0,
        totalTime: 0,
        minTime: duration,
        maxTime: duration,
        avgTime: duration,
        lastTime: duration
      }
      this.metrics.set(name, metric)
    }

    metric.count++
    metric.totalTime += duration
    metric.minTime = Math.min(metric.minTime, duration)
    metric.maxTime = Math.max(metric.maxTime, duration)
    metric.avgTime = metric.totalTime / metric.count
    metric.lastTime = duration

    this.emit('metric', { name, metric })
  }

  getMetric(name: string): PerformanceMetric | null {
    return this.metrics.get(name) || null
  }

  getAllMetrics(): Record<string, PerformanceMetric> {
    const result: Record<string, PerformanceMetric> = {}
    for (const [name, metric] of this.metrics.entries()) {
      result[name] = { ...metric }
    }
    return result
  }

  getSnapshots(limit?: number): PerformanceSnapshot[] {
    if (limit) {
      return this.snapshots.slice(-limit)
    }
    return [...this.snapshots]
  }

  clearMetrics(): void {
    this.metrics.clear()
  }

  private takeSnapshot(): void {
    const snapshot: PerformanceSnapshot = {
      timestamp: Date.now(),
      metrics: this.getAllMetrics(),
      memory: process.memoryUsage(),
      cpu: process.cpuUsage()
    }

    this.snapshots.push(snapshot)
    if (this.snapshots.length > this.MAX_SNAPSHOTS) {
      this.snapshots.shift()
    }

    this.emit('snapshot', snapshot)
  }

  destroy(): void {
    clearInterval(this.snapshotInterval)
    this.metrics.clear()
    this.snapshots = []
  }
}

export const performanceMonitor = new PerformanceMonitor()
