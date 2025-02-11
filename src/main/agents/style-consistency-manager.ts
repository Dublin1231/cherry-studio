import { EventEmitter } from 'events'

import { ModelAPI } from './model-api'

export interface StyleConfig {
  // 文风配置
  tone: 'formal' | 'casual' | 'literary' | 'technical' // 语气
  pov: 'first' | 'second' | 'third' | 'omniscient' // 视角
  tense: 'past' | 'present' // 时态
  narrativeStyle: 'descriptive' | 'dialogue' | 'action' | 'mixed' // 叙事风格

  // 语言特征
  vocabularyLevel: 'simple' | 'moderate' | 'advanced' // 词汇水平
  sentenceComplexity: 'simple' | 'moderate' | 'complex' // 句式复杂度
  figurativeLanguage: 'minimal' | 'moderate' | 'rich' // 修辞手法

  // 描写偏好
  detailLevel: 'minimal' | 'moderate' | 'detailed' // 细节程度
  emotionalIntensity: 'subtle' | 'moderate' | 'intense' // 情感强度
  pacePreference: 'slow' | 'moderate' | 'fast' // 节奏偏好
}

interface StyleAnalysis {
  matchScore: number // 风格匹配度(0-1)
  deviations: {
    aspect: keyof StyleConfig
    expected: string
    actual: string
    severity: 'low' | 'medium' | 'high'
  }[]
  suggestions: string[]
}

export class StyleConsistencyManager extends EventEmitter {
  private static instance: StyleConsistencyManager
  private model: ModelAPI
  private currentStyle: StyleConfig | null = null
  private styleHistory: Array<{
    timestamp: number
    content: string
    analysis: StyleAnalysis
  }> = []

  private constructor(model: ModelAPI) {
    super()
    this.model = model
  }

  static getInstance(model: ModelAPI): StyleConsistencyManager {
    if (!StyleConsistencyManager.instance) {
      StyleConsistencyManager.instance = new StyleConsistencyManager(model)
    }
    return StyleConsistencyManager.instance
  }

  // 设置目标文风
  setStyle(style: StyleConfig): void {
    this.currentStyle = style
    this.emit('style:updated', style)
  }

  // 获取当前文风配置
  getStyle(): StyleConfig | null {
    return this.currentStyle
  }

  // 分析文本风格
  async analyzeStyle(text: string): Promise<StyleAnalysis> {
    const prompt = `
请分析以下文本的写作风格，并与目标风格进行对比：

文本内容：
${text}

目标风格：
${JSON.stringify(this.currentStyle, null, 2)}

请提供：
1. 风格匹配度(0-1)
2. 风格偏差列表
3. 改进建议

以JSON格式输出。
`

    try {
      const response = await this.model.generate({
        prompt,
        temperature: 0.3
      })

      const analysis: StyleAnalysis = JSON.parse(response)

      // 记录分析历史
      this.styleHistory.push({
        timestamp: Date.now(),
        content: text,
        analysis
      })

      this.emit('style:analyzed', analysis)
      return analysis
    } catch (error) {
      console.error('风格分析失败:', error)
      throw error
    }
  }

  // 调整文本以符合目标风格
  async adjustStyle(text: string): Promise<string> {
    const analysis = await this.analyzeStyle(text)

    if (analysis.matchScore >= 0.9) {
      return text // 风格已经足够匹配
    }

    const prompt = `
请调整以下文本以更好地符合目标写作风格：

原文：
${text}

目标风格：
${JSON.stringify(this.currentStyle, null, 2)}

发现的问题：
${JSON.stringify(analysis.deviations, null, 2)}

改进建议：
${analysis.suggestions.join('\n')}

请保持内容不变，仅调整写作风格。
`

    const adjustedText = await this.model.generate({
      prompt,
      temperature: 0.4
    })

    this.emit('style:adjusted', {
      original: text,
      adjusted: adjustedText,
      analysis
    })

    return adjustedText
  }

  // 获取风格分析历史
  getStyleHistory(): typeof this.styleHistory {
    return this.styleHistory
  }

  // 清除风格分析历史
  clearStyleHistory(): void {
    this.styleHistory = []
    this.emit('style:history:cleared')
  }

  // 生成风格指导提示
  generateStylePrompt(): string {
    if (!this.currentStyle) {
      throw new Error('未设置目标文风')
    }

    return `
请使用以下风格特征进行创作：

语气：${this.currentStyle.tone}
视角：${this.currentStyle.pov}
时态：${this.currentStyle.tense}
叙事风格：${this.currentStyle.narrativeStyle}

语言特点：
- 词汇水平：${this.currentStyle.vocabularyLevel}
- 句式复杂度：${this.currentStyle.sentenceComplexity}
- 修辞手法：${this.currentStyle.figurativeLanguage}

描写特点：
- 细节程度：${this.currentStyle.detailLevel}
- 情感强度：${this.currentStyle.emotionalIntensity}
- 节奏偏好：${this.currentStyle.pacePreference}
`
  }
}

export const styleConsistencyManager = StyleConsistencyManager.getInstance(
  new ModelAPI({
    type: 'anthropic',
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    modelName: 'claude-2'
  })
)
