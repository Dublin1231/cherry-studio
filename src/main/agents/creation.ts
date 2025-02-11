import { novelService } from '../db/service'
import { BaseAgent } from './base'
import { MemoryManager } from './memory'
import { createModel, ModelAPI } from './model-api'
import { AgentMessage, AgentResult, CreationAgentConfig } from './types'

interface GenerationContext {
  novelId: string
  chapterNumber: number
  previousContent?: string
  memories?: any[]
  style?: any
}

export class CreationAgent extends BaseAgent {
  protected config: CreationAgentConfig
  private model: ModelAPI
  private memoryManager: MemoryManager

  constructor(config: CreationAgentConfig) {
    super(config)
    this.config = config
    this.model = createModel(config.model)
    this.memoryManager = new MemoryManager()
  }

  /**
   * 初始化创作智能体
   */
  public async init(): Promise<void> {
    try {
      // TODO: 初始化模型
      // this.model = await loadModel(this.config.modelConfig);

      // 注册消息处理器
      this.on('message', this.handleMessage.bind(this))
    } catch (error: any) {
      console.error('创作智能体初始化失败:', error)
      throw error
    }
  }

  /**
   * 处理接收到的消息
   */
  public async handleMessage(message: AgentMessage): Promise<AgentResult> {
    const startTime = Date.now()

    try {
      switch (message.type) {
        case 'generate_chapter':
          return await this.generateChapter(message.payload)
        case 'continue_generation':
          return await this.continueGeneration(message.payload)
        case 'apply_style':
          return await this.applyStyle(message.payload)
        default:
          throw new Error(`未知的消息类型: ${message.type}`)
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        metrics: {
          startTime,
          endTime: Date.now(),
          memoryUsage: process.memoryUsage().heapUsed
        }
      }
    }
  }

  /**
   * 生成新章节
   */
  private async generateChapter(context: GenerationContext): Promise<AgentResult> {
    try {
      // 1. 获取相关记忆
      const memories = await this.memoryManager.getRelevantMemories(context.novelId, context.chapterNumber)

      // 2. 构建生成提示词
      const prompt = this.buildPrompt(context, memories)

      // 3. 分段生成内容
      const segments = await this.generateSegments(prompt)

      // 4. 内容整合与优化
      const content = this.integrateContent(segments)

      // 5. 提取并存储新的记忆锚点
      await this.extractAndStoreMemories(content, context)

      return {
        success: true,
        data: {
          chapterIndex: context.chapterNumber,
          content,
          memoryAnchors: [] // TODO: 提取记忆锚点
        }
      }
    } catch (error: any) {
      throw new Error(`章节生成失败: ${error.message}`)
    }
  }

  private buildPrompt(context: GenerationContext, memories: any[]): string {
    const styleGuide = context.style || {}
    const memoryContext = this.formatMemories(memories)

    return `
你是一个专业的小说创作AI。请基于以下信息生成小说内容：

背景信息：
${memoryContext}

写作要求：
- 文风：${styleGuide.style || '流畅自然'}
- 情节节奏：${styleGuide.pace || '中等'}
- 描写倾向：${styleGuide.description || '细致'}

如果有前文：
${context.previousContent || '这是开始'}

请继续创作下一段内容，保持人物性格和情节的连贯性。
`
  }

  private async generateSegments(prompt: string): Promise<string[]> {
    const segmentLength = 2000 // 每段约2000字
    const segments: string[] = []

    // 使用流式生成
    for await (const chunk of this.model.streamGenerate({
      prompt,
      maxTokens: segmentLength,
      temperature: 0.7,
      topP: 0.9
    })) {
      segments.push(chunk)
    }

    return segments
  }

  private integrateContent(segments: string[]): string {
    // 简单的内容合并，后续可以添加更多优化逻辑
    return segments.join('')
  }

  private async extractAndStoreMemories(content: string, context: GenerationContext) {
    // 使用模型提取关键信息
    const memoryPrompt = `
请从以下文本中提取关键信息：
${content}

提取以下类型的信息：
1. 人物信息（性格、行为、关系）
2. 地点描述
3. 重要物品
4. 关键事件
5. 可能的伏笔

以JSON格式输出，包含类型、内容、重要性评分（0-1）。
`

    const memoryResponse = await this.model.generate({
      prompt: memoryPrompt,
      temperature: 0.3
    })

    try {
      const memories = JSON.parse(memoryResponse)

      // 存储提取的记忆
      for (const memory of memories) {
        await novelService.createMemoryAnchor({
          novelId: context.novelId,
          chapterId: `${context.novelId}-${context.chapterNumber}`,
          type: memory.type,
          content: memory.content,
          weight: memory.importance
        })
      }
    } catch (error) {
      console.error('记忆提取失败:', error)
    }
  }

  private formatMemories(memories: any[]): string {
    if (!memories.length) return '无相关历史信息'

    return memories.map((memory) => `${memory.type}: ${memory.content}`).join('\n')
  }

  /**
   * 继续生成
   */
  private async continueGeneration(payload: any): Promise<AgentResult> {
    const { content } = payload

    try {
      // TODO: 实现续写逻辑
      const newContent = content + '续写内容'

      return {
        success: true,
        data: {
          content: newContent,
          memoryAnchors: [] // TODO: 提取记忆锚点
        }
      }
    } catch (error: any) {
      throw new Error(`续写失败: ${error.message}`)
    }
  }

  /**
   * 应用文风
   */
  private async applyStyle(payload: any): Promise<AgentResult> {
    const { content, style } = payload

    try {
      const stylePreset = this.config.stylePresets[style]
      if (!stylePreset) {
        throw new Error(`未找到文风预设: ${style}`)
      }

      // TODO: 实现文风转换逻辑
      const styledContent = content

      return {
        success: true,
        data: {
          content: styledContent
        }
      }
    } catch (error: any) {
      throw new Error(`文风应用失败: ${error.message}`)
    }
  }

  /**
   * 清理资源
   */
  public async cleanup(): Promise<void> {
    // TODO: 清理模型资源
    this.removeAllListeners()
  }
}

// 创建智能体实例的工厂函数
export function createCreationAgent(config: any): CreationAgent {
  return new CreationAgent(config)
}
