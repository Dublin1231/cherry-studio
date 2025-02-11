import { MemoryManager } from './memory'
import { createModel, ModelAPI } from './model-api'

interface ValidationContext {
  novelId: string
  chapterNumber: number
  content: string
  checkPoints?: string[]
}

interface ValidationResult {
  isValid: boolean
  issues: ValidationIssue[]
  suggestions: string[]
}

interface ValidationIssue {
  type: 'character' | 'plot' | 'logic' | 'style' | 'world'
  severity: 'error' | 'warning' | 'info'
  description: string
  location?: {
    start: number
    end: number
  }
}

export class ValidationAgent {
  private model: ModelAPI
  private memoryManager: MemoryManager

  constructor(config: any) {
    this.model = createModel(config.model)
    this.memoryManager = new MemoryManager()
  }

  async validate(context: ValidationContext): Promise<ValidationResult> {
    // 1. 获取相关记忆和上下文
    const memories = await this.memoryManager.getRelevantMemories(context.novelId, context.chapterNumber)

    // 2. 执行各类验证
    const [characterIssues, plotIssues, logicIssues, styleIssues, worldIssues] = await Promise.all([
      this.validateCharacterConsistency(context, memories),
      this.validatePlotContinuity(context, memories),
      this.validateLogicConsistency(context),
      this.validateStyleConsistency(context),
      this.validateWorldRules(context, memories)
    ])

    // 3. 整合验证结果
    const allIssues = [...characterIssues, ...plotIssues, ...logicIssues, ...styleIssues, ...worldIssues]

    // 4. 生成修改建议
    const suggestions = await this.generateSuggestions(allIssues)

    return {
      isValid: allIssues.every((issue) => issue.severity !== 'error'),
      issues: allIssues,
      suggestions
    }
  }

  private async validateCharacterConsistency(context: ValidationContext, memories: any[]): Promise<ValidationIssue[]> {
    const characterPrompt = `
请检查以下文本中的人物表现是否与已知信息一致：

已知人物信息：
${this.formatCharacterMemories(memories)}

当前文本：
${context.content}

请检查：
1. 性格表现是否一致
2. 能力水平是否合理
3. 对话风格是否符合人设
4. 人物关系是否符合历史互动

以JSON格式输出发现的问题，包含问题类型、严重程度、描述和位置。
`

    const response = await this.model.generate({
      prompt: characterPrompt,
      temperature: 0.3
    })

    try {
      return JSON.parse(response)
    } catch (error) {
      console.error('角色一致性检查失败:', error)
      return []
    }
  }

  private async validatePlotContinuity(context: ValidationContext, memories: any[]): Promise<ValidationIssue[]> {
    const plotPrompt = `
请检查以下文本的情节连续性：

前文关键事件：
${this.formatPlotMemories(memories)}

当前文本：
${context.content}

请检查：
1. 情节是否自然衔接
2. 是否存在剧情跳跃
3. 伏笔是否合理回收
4. 时间线是否连贯

以JSON格式输出发现的问题。
`

    const response = await this.model.generate({
      prompt: plotPrompt,
      temperature: 0.3
    })

    try {
      return JSON.parse(response)
    } catch (error) {
      console.error('情节连续性检查失败:', error)
      return []
    }
  }

  private async validateLogicConsistency(context: ValidationContext): Promise<ValidationIssue[]> {
    const logicPrompt = `
请检查以下文本的逻辑一致性：

文本内容：
${context.content}

请检查：
1. 因果关系是否合理
2. 时间顺序是否正确
3. 空间关系是否准确
4. 事件发展是否符合逻辑

以JSON格式输出发现的问题。
`

    const response = await this.model.generate({
      prompt: logicPrompt,
      temperature: 0.3
    })

    try {
      return JSON.parse(response)
    } catch (error) {
      console.error('逻辑一致性检查失败:', error)
      return []
    }
  }

  private async validateStyleConsistency(context: ValidationContext): Promise<ValidationIssue[]> {
    const stylePrompt = `
请检查以下文本的写作风格：

文本内容：
${context.content}

请检查：
1. 文风是否统一
2. 语言是否流畅
3. 描写是否恰当
4. 节奏是否合适

以JSON格式输出发现的问题。
`

    const response = await this.model.generate({
      prompt: stylePrompt,
      temperature: 0.3
    })

    try {
      return JSON.parse(response)
    } catch (error) {
      console.error('风格一致性检查失败:', error)
      return []
    }
  }

  private async validateWorldRules(context: ValidationContext, memories: any[]): Promise<ValidationIssue[]> {
    const worldPrompt = `
请检查以下文本是否符合世界设定：

世界规则：
${this.formatWorldRules(memories)}

当前文本：
${context.content}

请检查：
1. 是否符合世界观设定
2. 超自然元素是否合理
3. 力量体系是否一致
4. 社会规则是否符合

以JSON格式输出发现的问题。
`

    const response = await this.model.generate({
      prompt: worldPrompt,
      temperature: 0.3
    })

    try {
      return JSON.parse(response)
    } catch (error) {
      console.error('世界规则检查失败:', error)
      return []
    }
  }

  private async generateSuggestions(issues: ValidationIssue[]): Promise<string[]> {
    if (!issues.length) return []

    const suggestionsPrompt = `
基于以下问题，提供具体的修改建议：

${issues
  .map(
    (issue) => `
类型：${issue.type}
严重程度：${issue.severity}
描述：${issue.description}
`
  )
  .join('\n')}

请提供具体、可操作的修改建议，每个建议应该：
1. 明确指出需要修改的内容
2. 提供具体的修改方向
3. 解释修改的理由

以JSON数组格式输出建议列表。
`

    const response = await this.model.generate({
      prompt: suggestionsPrompt,
      temperature: 0.5
    })

    try {
      return JSON.parse(response)
    } catch (error) {
      console.error('生成修改建议失败:', error)
      return []
    }
  }

  private formatCharacterMemories(memories: any[]): string {
    return memories
      .filter((m) => m.type === 'character')
      .map((m) => m.content)
      .join('\n')
  }

  private formatPlotMemories(memories: any[]): string {
    return memories
      .filter((m) => m.type === 'event')
      .map((m) => m.content)
      .join('\n')
  }

  private formatWorldRules(memories: any[]): string {
    return memories
      .filter((m) => m.type === 'world')
      .map((m) => m.content)
      .join('\n')
  }
}

// 创建校验智能体实例的工厂函数
export function createValidationAgent(config: any): ValidationAgent {
  return new ValidationAgent(config)
}
