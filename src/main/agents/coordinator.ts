import { EventEmitter } from 'events'

import { CreationAgent } from './creation'
import { MemoryAgent } from './memory'
import { AgentMessage, AgentStatus, AgentType } from './types'
import { ValidationAgent } from './validation'

export class AgentCoordinator extends EventEmitter {
  private agents: Map<AgentType, any>
  private messageQueue: AgentMessage[]

  constructor() {
    super()
    this.agents = new Map()
    this.messageQueue = []
  }

  /**
   * 初始化协调器
   */
  public async init(configs: Record<AgentType, any>): Promise<void> {
    try {
      // 创建并初始化各个智能体
      this.agents.set(AgentType.CREATION, new CreationAgent(configs[AgentType.CREATION]))
      this.agents.set(AgentType.VALIDATION, new ValidationAgent(configs[AgentType.VALIDATION]))
      this.agents.set(AgentType.MEMORY, new MemoryAgent(configs[AgentType.MEMORY]))

      // 初始化所有智能体
      for (const [type, agent] of this.agents.entries()) {
        try {
          await agent.init()
          this.setupAgentListeners(type, agent)
        } catch (error: any) {
          console.error(`初始化${type}智能体失败:`, error)
          throw error
        }
      }

      // 开始处理消息队列
      this.processMessageQueue()
    } catch (error: any) {
      console.error('协调器初始化失败:', error)
      throw error
    }
  }

  /**
   * 设置智能体事件监听
   */
  private setupAgentListeners(type: AgentType, agent: any): void {
    agent.on('message', (message: AgentMessage) => {
      this.handleAgentMessage(type, message)
    })

    agent.on('status-change', (status: AgentStatus) => {
      this.emit('agent-status', { type, status })
    })

    agent.on('error', (error: Error) => {
      this.emit('agent-error', { type, error })
    })
  }

  /**
   * 处理智能体消息
   */
  private async handleAgentMessage(senderType: AgentType, message: AgentMessage): Promise<void> {
    const targetAgent = this.agents.get(message.receiver as AgentType)
    if (!targetAgent) {
      console.error(`目标智能体不存在: ${message.receiver}`)
      return
    }

    try {
      await targetAgent.addToQueue(message)
    } catch (error: any) {
      console.error('消息处理失败:', error)
      this.emit('message-error', { message, error })
    }
  }

  /**
   * 发送消息到智能体
   */
  public async sendMessage(message: AgentMessage): Promise<void> {
    this.messageQueue.push(message)
    await this.processMessageQueue()
  }

  /**
   * 处理消息队列
   */
  private async processMessageQueue(): Promise<void> {
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift()
      if (!message) continue

      const targetAgent = this.agents.get(message.receiver as AgentType)
      if (!targetAgent) {
        console.error(`目标智能体不存在: ${message.receiver}`)
        continue
      }

      try {
        await targetAgent.addToQueue(message)
      } catch (error: any) {
        console.error('消息处理失败:', error)
        this.emit('message-error', { message, error })
      }
    }
  }

  /**
   * 获取智能体状态
   */
  public getAgentStatus(type: AgentType): AgentStatus {
    const agent = this.agents.get(type)
    return agent ? agent.getStatus() : AgentStatus.ERROR
  }

  /**
   * 获取所有智能体状态
   */
  public getAllAgentStatus(): Record<AgentType, AgentStatus> {
    const status: Record<AgentType, AgentStatus> = {} as Record<AgentType, AgentStatus>
    for (const [type, agent] of this.agents.entries()) {
      status[type] = agent.getStatus()
    }
    return status
  }

  /**
   * 清理资源
   */
  public async cleanup(): Promise<void> {
    // 清理所有智能体
    for (const agent of this.agents.values()) {
      try {
        await agent.cleanup()
      } catch (error: any) {
        console.error('智能体清理失败:', error)
      }
    }

    // 清空消息队列
    this.messageQueue = []

    // 移除所有事件监听
    this.removeAllListeners()
  }
}
