import { EventEmitter } from 'events'

import { AgentConfig, AgentMessage, AgentResult, AgentStatus } from './types'

export abstract class BaseAgent extends EventEmitter {
  protected config: AgentConfig
  protected status: AgentStatus
  protected messageQueue: AgentMessage[]

  constructor(config: AgentConfig) {
    super()
    this.config = config
    this.status = AgentStatus.IDLE
    this.messageQueue = []
  }

  /**
   * 初始化智能体
   */
  public abstract init(): Promise<void>

  /**
   * 处理接收到的消息
   */
  public abstract handleMessage(message: AgentMessage): Promise<AgentResult>

  /**
   * 发送消息到其他智能体
   */
  protected async sendMessage(message: AgentMessage): Promise<void> {
    this.emit('message', message)
  }

  /**
   * 更新智能体状态
   */
  protected updateStatus(status: AgentStatus): void {
    this.status = status
    this.emit('status-change', status)
  }

  /**
   * 获取当前状态
   */
  public getStatus(): AgentStatus {
    return this.status
  }

  /**
   * 添加消息到队列
   */
  public async addToQueue(message: AgentMessage): Promise<void> {
    this.messageQueue.push(message)
    this.emit('queue-update', this.messageQueue.length)
    await this.processQueue()
  }

  /**
   * 处理消息队列
   */
  protected async processQueue(): Promise<void> {
    if (this.status === AgentStatus.BUSY || this.messageQueue.length === 0) {
      return
    }

    this.updateStatus(AgentStatus.BUSY)

    try {
      const message = this.messageQueue.shift()
      if (message) {
        const result = await this.handleMessage(message)
        this.emit('message-processed', { message, result })
      }
    } catch (error) {
      this.updateStatus(AgentStatus.ERROR)
      this.emit('error', error)
    } finally {
      this.updateStatus(AgentStatus.IDLE)

      // 继续处理队列中的其他消息
      if (this.messageQueue.length > 0) {
        await this.processQueue()
      }
    }
  }

  /**
   * 清理资源
   */
  public abstract cleanup(): Promise<void>
}
