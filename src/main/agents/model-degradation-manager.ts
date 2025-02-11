import { EventEmitter } from 'events'

interface DegradationConfig {
  errorThreshold: number // 错误率阈值
  latencyThreshold: number // 延迟阈值(毫秒)
  recoveryInterval: number // 恢复检查间隔(毫秒)
  checkInterval: number // 健康检查间隔(毫秒)
}

interface ModelHealth {
  isHealthy: boolean
  errorRate: number
  avgLatency: number
  lastCheck: number
  consecutiveFailures: number
  degraded: boolean
}

interface DegradationStrategy {
  priority: number
  condition: (health: ModelHealth) => boolean
  action: (modelId: string) => Promise<void>
}

export class ModelDegradationManager extends EventEmitter {
  private static instance: ModelDegradationManager
  private modelHealth: Map<string, ModelHealth> = new Map()
  private degradationStrategies: DegradationStrategy[] = []
  private backupModels: Map<string, string[]> = new Map() // 主模型 -> 备用模型列表

  private readonly DEFAULT_CONFIG: DegradationConfig = {
    errorThreshold: 0.1, // 10%错误率
    latencyThreshold: 5000, // 5秒
    recoveryInterval: 5 * 60 * 1000, // 5分钟
    checkInterval: 30 * 1000 // 30秒
  }

  private constructor(private config: Partial<DegradationConfig> = {}) {
    super()
    this.config = { ...this.DEFAULT_CONFIG, ...config } as DegradationConfig
    this.initializeStrategies()
    this.startHealthCheck()
  }

  static getInstance(config?: Partial<DegradationConfig>): ModelDegradationManager {
    if (!ModelDegradationManager.instance) {
      ModelDegradationManager.instance = new ModelDegradationManager(config)
    }
    return ModelDegradationManager.instance
  }

  // 注册备用模型
  registerBackupModels(primaryModel: string, backups: string[]): void {
    this.backupModels.set(primaryModel, backups)
    this.initializeModelHealth(primaryModel)
    backups.forEach((backup) => this.initializeModelHealth(backup))
  }

  // 记录模型调用结果
  recordModelCall(modelId: string, latency: number, success: boolean): void {
    const health = this.getModelHealth(modelId)

    // 更新健康状态
    health.avgLatency = (health.avgLatency * 9 + latency) / 10 // 指数移动平均
    if (!success) {
      health.consecutiveFailures++
      this.checkDegradation(modelId)
    } else {
      health.consecutiveFailures = 0
    }

    // 更新错误率
    const errorWeight = success ? 0 : 1
    health.errorRate = (health.errorRate * 9 + errorWeight) / 10

    this.modelHealth.set(modelId, health)
  }

  // 获取当前应该使用的模型
  getCurrentModel(primaryModel: string): string {
    const backups = this.backupModels.get(primaryModel) || []
    const allModels = [primaryModel, ...backups]

    // 找到第一个健康的模型
    for (const modelId of allModels) {
      const health = this.getModelHealth(modelId)
      if (!health.degraded) {
        return modelId
      }
    }

    // 如果所有模型都不健康，返回主模型
    return primaryModel
  }

  // 检查模型是否需要降级
  private checkDegradation(modelId: string): void {
    const health = this.getModelHealth(modelId)

    for (const strategy of this.degradationStrategies) {
      if (strategy.condition(health) && !health.degraded) {
        health.degraded = true
        this.modelHealth.set(modelId, health)

        this.emit('model:degraded', {
          modelId,
          reason: 'health_check_failed',
          health
        })

        strategy.action(modelId).catch((error) => {
          console.error(`降级策略执行失败: ${error.message}`)
        })

        break
      }
    }
  }

  // 初始化降级策略
  private initializeStrategies(): void {
    const errorThreshold = this.config?.errorThreshold ?? this.DEFAULT_CONFIG.errorThreshold
    const latencyThreshold = this.config?.latencyThreshold ?? this.DEFAULT_CONFIG.latencyThreshold

    // 策略1: 连续失败次数过多
    this.degradationStrategies.push({
      priority: 1,
      condition: (health) => health.consecutiveFailures >= 3,
      action: async (modelId) => {
        console.log(`模型 ${modelId} 连续失败次数过多，触发降级`)
        await this.switchToBackup(modelId)
      }
    })

    // 策略2: 错误率过高
    this.degradationStrategies.push({
      priority: 2,
      condition: (health) => health.errorRate >= errorThreshold,
      action: async (modelId) => {
        console.log(`模型 ${modelId} 错误率过高，触发降级`)
        await this.switchToBackup(modelId)
      }
    })

    // 策略3: 延迟过高
    this.degradationStrategies.push({
      priority: 3,
      condition: (health) => health.avgLatency >= latencyThreshold,
      action: async (modelId) => {
        console.log(`模型 ${modelId} 延迟过高，触发降级`)
        await this.switchToBackup(modelId)
      }
    })
  }

  // 切换到备用模型
  private async switchToBackup(modelId: string): Promise<void> {
    // 实际的模型切换逻辑将在ModelAPI中实现
    this.emit('model:switch', {
      fromModel: modelId,
      toModel: this.findHealthyBackup(modelId)
    })
  }

  // 查找健康的备用模型
  private findHealthyBackup(primaryModel: string): string | null {
    const backups = this.backupModels.get(primaryModel) || []
    return backups.find((backup) => !this.getModelHealth(backup).degraded) || null
  }

  // 初始化模型健康状态
  private initializeModelHealth(modelId: string): void {
    if (!this.modelHealth.has(modelId)) {
      this.modelHealth.set(modelId, {
        isHealthy: true,
        errorRate: 0,
        avgLatency: 0,
        lastCheck: Date.now(),
        consecutiveFailures: 0,
        degraded: false
      })
    }
  }

  // 获取模型健康状态
  private getModelHealth(modelId: string): ModelHealth {
    return (
      this.modelHealth.get(modelId) || {
        isHealthy: true,
        errorRate: 0,
        avgLatency: 0,
        lastCheck: Date.now(),
        consecutiveFailures: 0,
        degraded: false
      }
    )
  }

  // 启动定期健康检查
  private startHealthCheck(): void {
    const checkInterval = this.config?.checkInterval ?? this.DEFAULT_CONFIG.checkInterval
    const recoveryInterval = this.config?.recoveryInterval ?? this.DEFAULT_CONFIG.recoveryInterval

    setInterval(() => {
      for (const [modelId, health] of this.modelHealth.entries()) {
        // 检查是否需要恢复
        if (health.degraded && Date.now() - health.lastCheck >= recoveryInterval) {
          this.checkRecovery(modelId)
        }
        health.lastCheck = Date.now()
      }
    }, checkInterval)
  }

  // 检查是否可以恢复服务
  private async checkRecovery(modelId: string): Promise<void> {
    const health = this.getModelHealth(modelId)
    const errorThreshold = this.config?.errorThreshold ?? this.DEFAULT_CONFIG.errorThreshold
    const latencyThreshold = this.config?.latencyThreshold ?? this.DEFAULT_CONFIG.latencyThreshold

    // 如果错误率和延迟都恢复正常，可以解除降级
    if (health.errorRate < errorThreshold && health.avgLatency < latencyThreshold && health.consecutiveFailures === 0) {
      health.degraded = false
      this.modelHealth.set(modelId, health)

      this.emit('model:recovered', {
        modelId,
        health
      })
    }
  }

  // 获取所有模型的健康状态
  getHealthStatus(): Map<string, ModelHealth> {
    return new Map(this.modelHealth)
  }

  // 重置模型的健康状态
  resetHealth(modelId: string): void {
    this.initializeModelHealth(modelId)
  }
}

export const modelDegradationManager = ModelDegradationManager.getInstance()
