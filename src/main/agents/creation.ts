import { EventEmitter } from 'events'

import { BaseAgent } from './base'
import { MemoryManager } from './memory'
import { createModel, ModelAPI } from './model-api'
import { AgentMessage, AgentResult, CreationAgentConfig } from './types'

interface GenerationContext {
  novelId: string
  chapterNumber: number
  background: string
  style?: string
}

interface GenerationParams {
  prompt: string
  temperature?: number
  maxTokens?: number
}

interface GenerationResponse {
  content: string
}

// 生成控制器
class GenerationController extends EventEmitter {
  private activeGenerations = new Map<string, any>()

  public startGeneration(id: string, context: any) {
    this.activeGenerations.set(id, { status: 'active', context })
    this.emit('generationStarted', id)
  }

  public pauseGeneration(id: string) {
    const gen = this.activeGenerations.get(id)
    if (gen) {
      gen.status = 'paused'
      this.emit('generationPaused', id)
    }
  }

  public resumeGeneration(id: string): boolean {
    const gen = this.activeGenerations.get(id)
    if (gen && gen.status === 'paused') {
      gen.status = 'active'
      this.emit('generationResumed', id)
      return true
    }
    return false
  }

  public updateProgress(id: string, progress: number, content: string) {
    this.emit('generationProgress', id, progress, content)
  }

  public completeGeneration(id: string, content: string) {
    this.activeGenerations.delete(id)
    this.emit('generationCompleted', id, content)
  }

  public handleGenerationError(id: string, error: Error) {
    this.activeGenerations.delete(id)
    this.emit('generationError', id, error)
  }

  public getGenerationState(id: string) {
    return this.activeGenerations.get(id)
  }
}

const generationController = new GenerationController()

export class CreationAgent extends BaseAgent {
  private model: ModelAPI
  private memoryManager: MemoryManager

  constructor(config: CreationAgentConfig) {
    super(config)
    this.model = createModel(config.modelConfig)
    this.memoryManager = new MemoryManager()
    this.setupGenerationEvents()
  }

  public async init(): Promise<void> {
    // 初始化代理
    this.setupGenerationEvents()
  }

  public async cleanup(): Promise<void> {
    // 清理资源
    this.removeAllListeners()
  }

  private setupGenerationEvents() {
    // 监听生成状态变化
    generationController.on('generationStarted', (id: string) => {
      this.emit('progress', { id, status: 'started', progress: 0 })
    })

    generationController.on('generationPaused', (id: string) => {
      this.emit('progress', { id, status: 'paused' })
    })

    generationController.on('generationResumed', (id: string) => {
      this.emit('progress', { id, status: 'resumed' })
    })

    generationController.on('generationProgress', (id: string, progress: number, content: string) => {
      this.emit('progress', { id, status: 'generating', progress, content })
    })

    generationController.on('generationCompleted', (id: string, content: string) => {
      this.emit('progress', { id, status: 'completed', progress: 100, content })
    })

    generationController.on('generationError', (id: string, error: Error) => {
      this.emit('progress', { id, status: 'error', error: error.message })
    })
  }

  public async handleMessage(message: AgentMessage): Promise<AgentResult> {
    const startTime = Date.now()

    try {
      const result = await this.processMessage(message)
      const duration = Date.now() - startTime
      this.emit('metrics', { type: message.type, duration })
      return result
    } catch (error: any) {
      const duration = Date.now() - startTime
      this.emit('metrics', { type: message.type, duration, error: error.message })
      throw error
    }
  }

  private async processMessage(message: AgentMessage): Promise<AgentResult> {
    switch (message.type) {
      case 'generate_chapter':
        return await this.generateChapter(message.payload)
      case 'continue_generation':
        return await this.continueGeneration(message.payload)
      case 'pause_generation': {
        const { chapterId } = message.payload
        generationController.pauseGeneration(chapterId)
        return { success: true }
      }
      default:
        throw new Error(`未知的消息类型: ${message.type}`)
    }
  }

  private async generateChapter(payload: any): Promise<AgentResult> {
    const { chapterId, context } = payload

    try {
      // 启动生成任务
      generationController.startGeneration(chapterId, context)

      // 生成内容
      let content = ''
      let progress = 0

      // 第1步: 大纲生成
      progress = 20
      content = await this.generateOutline(context)
      generationController.updateProgress(chapterId, progress, content)

      // 检查是否暂停
      if (this.checkPauseState(chapterId)) {
        return { success: false, error: '生成已暂停' }
      }

      // 第2步: 场景展开
      progress = 40
      content = await this.expandScenes(content)
      generationController.updateProgress(chapterId, progress, content)

      if (this.checkPauseState(chapterId)) {
        return { success: false, error: '生成已暂停' }
      }

      // 第3步: 对话生成
      progress = 60
      content = await this.generateDialogues(content)
      generationController.updateProgress(chapterId, progress, content)

      if (this.checkPauseState(chapterId)) {
        return { success: false, error: '生成已暂停' }
      }

      // 第4步: 细节描写
      progress = 80
      content = await this.addDetails(content)
      generationController.updateProgress(chapterId, progress, content)

      if (this.checkPauseState(chapterId)) {
        return { success: false, error: '生成已暂停' }
      }

      // 第5步: 最终润色
      progress = 100
      content = await this.polish(content)

      // 完成生成
      generationController.completeGeneration(chapterId, content)

      return {
        success: true,
        data: {
          content,
          memoryAnchors: [] // TODO: 提取记忆锚点
        }
      }
    } catch (error: any) {
      generationController.handleGenerationError(chapterId, error)
      throw error
    }
  }

  private checkPauseState(id: string): boolean {
    const state = generationController.getGenerationState(id)
    return state?.status === 'paused'
  }

  private async continueGeneration(payload: any): Promise<AgentResult> {
    const { chapterId } = payload

    try {
      // 恢复生成
      if (!generationController.resumeGeneration(chapterId)) {
        throw new Error('无法恢复生成,任务可能不存在或状态错误')
      }

      const state = generationController.getGenerationState(chapterId)
      if (!state) {
        throw new Error('获取生成状态失败')
      }

      // 从上次的进度继续生成
      let { content, progress } = state

      // 根据进度继续生成
      if (progress < 40) {
        // 继续场景展开
        progress = 40
        content = await this.expandScenes(content)
        generationController.updateProgress(chapterId, progress, content)
      }

      if (progress < 60 && !this.checkPauseState(chapterId)) {
        // 继续对话生成
        progress = 60
        content = await this.generateDialogues(content)
        generationController.updateProgress(chapterId, progress, content)
      }

      if (progress < 80 && !this.checkPauseState(chapterId)) {
        // 继续细节描写
        progress = 80
        content = await this.addDetails(content)
        generationController.updateProgress(chapterId, progress, content)
      }

      if (progress < 100 && !this.checkPauseState(chapterId)) {
        // 完成最终润色
        progress = 100
        content = await this.polish(content)
        generationController.completeGeneration(chapterId, content)
      }

      return {
        success: true,
        data: {
          content,
          memoryAnchors: [] // TODO: 提取记忆锚点
        }
      }
    } catch (error: any) {
      generationController.handleGenerationError(chapterId, error)
      throw error
    }
  }

  /**
   * 生成章节大纲
   */
  private async generateOutline(context: GenerationContext): Promise<string> {
    const params: GenerationParams = {
      prompt: `请根据以下背景生成一个详细的章节大纲:
      ${context.background}
      要求:
      1. 包含3-5个主要场景
      2. 每个场景说明地点、人物、主要事件
      3. 符合整体故事走向和人物性格`,
      temperature: 0.7,
      maxTokens: 1000
    }

    const response = (await this.model.generate(params)) as GenerationResponse
    return response.content
  }

  /**
   * 展开场景描写
   */
  private async expandScenes(content: string): Promise<string> {
    const params: GenerationParams = {
      prompt: `请根据以下大纲展开详细的场景描写:
      ${content}
      要求:
      1. 生动描绘场景环境和氛围
      2. 展现人物的动作、表情和心理
      3. 通过细节烘托情节发展`,
      temperature: 0.7,
      maxTokens: 2000
    }

    const response = (await this.model.generate(params)) as GenerationResponse
    return response.content
  }

  /**
   * 生成对话内容
   */
  private async generateDialogues(content: string): Promise<string> {
    const params: GenerationParams = {
      prompt: `请在以下内容中添加自然的对话:
      ${content}
      要求:
      1. 对话要符合人物性格
      2. 推动情节发展
      3. 展现人物关系和情感变化`,
      temperature: 0.7,
      maxTokens: 2000
    }

    const response = (await this.model.generate(params)) as GenerationResponse
    return response.content
  }

  /**
   * 添加细节描写
   */
  private async addDetails(content: string): Promise<string> {
    const params: GenerationParams = {
      prompt: `请为以下内容添加更丰富的细节描写:
      ${content}
      要求:
      1. 添加感官描写
      2. 补充环境细节
      3. 深化人物刻画`,
      temperature: 0.7,
      maxTokens: 2000
    }

    const response = (await this.model.generate(params)) as GenerationResponse
    return response.content
  }

  /**
   * 最终润色
   */
  private async polish(content: string): Promise<string> {
    const params: GenerationParams = {
      prompt: `请对以下内容进行最终润色:
      ${content}
      要求:
      1. 优化语言表达
      2. 调整节奏韵律
      3. 确保情节连贯
      4. 突出主题思想`,
      temperature: 0.7,
      maxTokens: 2000
    }

    const response = (await this.model.generate(params)) as GenerationResponse
    return response.content
  }
}

// 创建智能体实例的工厂函数
export function createCreationAgent(config: any): CreationAgent {
  return new CreationAgent(config)
}
