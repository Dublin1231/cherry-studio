import Anthropic from '@anthropic-ai/sdk'
import axios from 'axios'
import OpenAI from 'openai'

import { modelDegradationManager } from './model-degradation-manager'
import { modelResponseCache } from './model-response-cache'
import { modelRetryManager } from './model-retry-manager'
import { parameterAdjustmentManager } from './parameter-adjustment-manager'
import { qualityAssessmentManager, QualityThresholds } from './quality-assessment-manager'
import { StyleConfig, styleConsistencyManager } from './style-consistency-manager'

// 模型配置接口
interface ModelConfig {
  type: 'openai' | 'anthropic' | 'deepseek'
  apiKey: string
  baseUrl?: string
  modelName: string
  styleConfig?: StyleConfig // 添加风格配置
}

// 生成参数接口
interface GenerationParams {
  prompt: string
  maxTokens?: number
  temperature?: number
  topP?: number
  frequencyPenalty?: number
  presencePenalty?: number
  stop?: string[]
  enforceStyle?: boolean // 是否强制执行风格一致性
  qualityCheck?: boolean // 添加质量检查选项
  qualityThresholds?: Partial<QualityThresholds> // 添加质量阈值配置
  taskType?: 'creative' | 'factual' | 'technical' // 添加任务类型
  enableParameterAdjustment?: boolean // 添加参数调整开关
}

export class ModelAPI {
  private static instance: ModelAPI
  private config: ModelConfig
  private openai: OpenAI | null = null
  private claude: Anthropic | null = null
  private deepseekApi: string | null = null
  private startTime: number = 0

  constructor(config: ModelConfig) {
    this.config = config
    this.initializeClient()
    this.setupBackupModels()
  }

  private initializeClient() {
    switch (this.config.type) {
      case 'openai':
        this.openai = new OpenAI({
          apiKey: this.config.apiKey,
          baseURL: this.config.baseUrl
        })
        break

      case 'anthropic':
        this.claude = new Anthropic({
          apiKey: this.config.apiKey
        })
        break

      case 'deepseek':
        this.deepseekApi = this.config.baseUrl || 'https://api.deepseek.com/v1'
        break
    }
  }

  private setupBackupModels() {
    // 根据模型类型设置备用模型
    switch (this.config.type) {
      case 'openai':
        modelDegradationManager.registerBackupModels(
          this.config.modelName,
          ['gpt-3.5-turbo', 'text-davinci-003'] // OpenAI的备用模型
        )
        break
      case 'anthropic':
        modelDegradationManager.registerBackupModels(
          this.config.modelName,
          ['claude-instant-1', 'claude-2.0'] // Anthropic的备用模型
        )
        break
      case 'deepseek':
        modelDegradationManager.registerBackupModels(
          this.config.modelName,
          ['deepseek-chat', 'deepseek-base'] // Deepseek的备用模型
        )
        break
    }
  }

  async generate(params: GenerationParams): Promise<string> {
    // 尝试从缓存获取响应
    const cachedResponse = await modelResponseCache.get(this.config.modelName, params.prompt, params)
    if (cachedResponse) {
      // 如果启用了质量检查，对缓存的响应也进行检查
      if (params.qualityCheck) {
        const assessment = await qualityAssessmentManager.assessTextQuality(cachedResponse)
        if (params.qualityThresholds) {
          qualityAssessmentManager.setThresholds(params.qualityThresholds)
        }
        const { passed } = qualityAssessmentManager.checkQualityThresholds(assessment.metrics)
        if (!passed) {
          console.warn('缓存响应未通过质量检查，将重新生成')
          // 继续执行生成逻辑
        } else {
          return cachedResponse
        }
      } else {
        return cachedResponse
      }
    }

    this.startTime = Date.now()

    try {
      // 获取当前应该使用的模型
      const currentModel = modelDegradationManager.getCurrentModel(this.config.modelName)

      // 如果使用了备用模型，修改配置
      if (currentModel !== this.config.modelName) {
        console.log(`使用备用模型: ${currentModel}`)
        this.config.modelName = currentModel
      }

      // 如果启用了参数调整，先获取调整后的参数
      let finalParams = { ...params }
      if (params.enableParameterAdjustment && params.taskType) {
        const parameterConfig = {
          temperature: params.temperature || 0.7,
          topP: params.topP || 1.0,
          frequencyPenalty: params.frequencyPenalty || 0.0,
          presencePenalty: params.presencePenalty || 0.0,
          maxTokens: params.maxTokens
        }

        // 如果有缓存的响应，使用它来调整参数
        if (cachedResponse) {
          const adjustmentResult = await parameterAdjustmentManager.adjustParameters(
            parameterConfig,
            cachedResponse,
            params.taskType
          )
          finalParams = {
            ...params,
            ...adjustmentResult.adjustedParams
          }
          console.log('参数调整结果:', adjustmentResult.adjustmentReason)
        }
      }

      // 如果设置了风格配置，添加风格提示
      let finalPrompt = params.prompt
      if (this.config.styleConfig && params.enforceStyle !== false) {
        styleConsistencyManager.setStyle(this.config.styleConfig)
        finalPrompt = `${styleConsistencyManager.generateStylePrompt()}\n\n${params.prompt}`
      }

      // 使用重试管理器执行生成
      let response = await modelRetryManager.executeWithRetry(
        this.config.modelName,
        async () => {
          switch (this.config.type) {
            case 'openai':
              return await this.generateWithOpenAI({ ...finalParams, prompt: finalPrompt })
            case 'anthropic':
              return await this.generateWithClaude({ ...finalParams, prompt: finalPrompt })
            case 'deepseek':
              return await this.generateWithDeepseek({ ...finalParams, prompt: finalPrompt })
            default:
              throw new Error('不支持的模型类型')
          }
        },
        {
          maxAttempts: 3,
          initialDelay: 1000,
          maxDelay: 10000,
          backoffFactor: 2
        }
      )

      // 如果启用了参数调整，使用生成的响应进行参数调整分析
      if (params.enableParameterAdjustment && params.taskType) {
        const parameterConfig = {
          temperature: finalParams.temperature || 0.7,
          topP: finalParams.topP || 1.0,
          frequencyPenalty: finalParams.frequencyPenalty || 0.0,
          presencePenalty: finalParams.presencePenalty || 0.0,
          maxTokens: finalParams.maxTokens
        }

        const adjustmentResult = await parameterAdjustmentManager.adjustParameters(
          parameterConfig,
          response,
          params.taskType
        )
        console.log('最终参数调整结果:', {
          reason: adjustmentResult.adjustmentReason,
          qualityScore: adjustmentResult.qualityScore,
          params: adjustmentResult.adjustedParams
        })

        // 分析参数调整效果
        const effectiveness = await parameterAdjustmentManager.analyzeAdjustmentEffectiveness()
        console.log('参数调整效果分析:', effectiveness)
      }

      // 如果启用了风格一致性检查，进行风格调整
      if (this.config.styleConfig && params.enforceStyle !== false) {
        response = await styleConsistencyManager.adjustStyle(response)
      }

      // 如果启用了质量检查，进行质量评估
      if (params.qualityCheck) {
        if (params.qualityThresholds) {
          qualityAssessmentManager.setThresholds(params.qualityThresholds)
        }
        const assessment = await qualityAssessmentManager.assessTextQuality(response)
        const { passed, failures } = qualityAssessmentManager.checkQualityThresholds(assessment.metrics)

        if (!passed) {
          console.warn('生成的内容未通过质量检查:', failures)
          // 可以选择重新生成或进行调整
          const report = qualityAssessmentManager.generateQualityReport(assessment)
          console.log('质量评估报告:', report)

          // 尝试根据质量评估结果优化响应
          const optimizationPrompt = `
请根据以下质量评估结果优化文本内容：

原文：
${response}

质量评估：
${report}

请保持原文的核心内容，同时提高以下方面的质量：
${failures.map((f) => `- ${f.metric}: 当前 ${(f.actual * 100).toFixed(1)}%，需要达到 ${(f.required * 100).toFixed(1)}%`).join('\n')}
`

          response = await this.generate({
            ...params,
            prompt: optimizationPrompt,
            qualityCheck: false // 避免无限循环
          })
        }
      }

      // 记录成功的调用
      const latency = Date.now() - this.startTime
      modelDegradationManager.recordModelCall(this.config.modelName, latency, true)

      // 将响应存入缓存
      modelResponseCache.set(this.config.modelName, params.prompt, params, response)

      return response
    } catch (error) {
      // 记录失败的调用
      const latency = Date.now() - this.startTime
      modelDegradationManager.recordModelCall(this.config.modelName, latency, false)

      throw error
    }
  }

  private async generateWithOpenAI(params: GenerationParams): Promise<string> {
    if (!this.openai) throw new Error('OpenAI客户端未初始化')

    const response = await this.openai.chat.completions.create({
      model: this.config.modelName,
      messages: [{ role: 'user', content: params.prompt }],
      max_tokens: params.maxTokens,
      temperature: params.temperature,
      top_p: params.topP,
      frequency_penalty: params.frequencyPenalty,
      presence_penalty: params.presencePenalty,
      stop: params.stop
    })

    return response.choices[0]?.message?.content || ''
  }

  private async generateWithClaude(params: GenerationParams): Promise<string> {
    if (!this.claude) throw new Error('Claude客户端未初始化')

    const response = await this.claude.messages.create({
      model: this.config.modelName,
      messages: [{ role: 'user', content: params.prompt }],
      max_tokens: params.maxTokens || 1000,
      temperature: params.temperature,
      top_p: params.topP,
      stop_sequences: params.stop
    })

    if (response.content[0].type === 'text') {
      return response.content[0].text
    }
    return ''
  }

  private async generateWithDeepseek(params: GenerationParams): Promise<string> {
    if (!this.deepseekApi) throw new Error('Deepseek API未初始化')

    const response = await axios.post(
      `${this.deepseekApi}/completions`,
      {
        model: this.config.modelName,
        prompt: params.prompt,
        max_tokens: params.maxTokens,
        temperature: params.temperature,
        top_p: params.topP,
        frequency_penalty: params.frequencyPenalty,
        presence_penalty: params.presencePenalty,
        stop: params.stop
      },
      {
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    )

    return response.data.choices[0]?.text || ''
  }

  // 批量生成方法
  async batchGenerate(prompts: string[]): Promise<string[]> {
    return Promise.all(prompts.map((prompt) => this.generate({ prompt })))
  }

  // 流式生成方法
  async *streamGenerate(params: GenerationParams): AsyncGenerator<string> {
    const { type } = this.config

    switch (type) {
      case 'openai': {
        if (!this.openai) throw new Error('OpenAI客户端未初始化')

        const stream = await this.openai.chat.completions.create({
          model: this.config.modelName,
          messages: [{ role: 'user', content: params.prompt }],
          stream: true,
          max_tokens: params.maxTokens,
          temperature: params.temperature,
          top_p: params.topP
        })

        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content
          if (content) yield content
        }
        break
      }

      // 其他模型的流式生成实现...
      default:
        // 对于不支持流式生成的模型，退化为普通生成
        yield await this.generate(params)
    }
  }
}

// 创建模型实例的工厂函数
export function createModel(config: ModelConfig): ModelAPI {
  return new ModelAPI(config)
}
