import { Claude } from '@anthropic-ai/sdk'
import axios from 'axios'
import { Configuration, OpenAIApi } from 'openai'

// 模型配置接口
interface ModelConfig {
  type: 'openai' | 'anthropic' | 'deepseek'
  apiKey: string
  baseUrl?: string
  modelName: string
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
}

export class ModelAPI {
  private openai: OpenAIApi | null = null
  private claude: Claude | null = null
  private deepseekApi: string | null = null

  constructor(private config: ModelConfig) {
    this.initializeClient()
  }

  private initializeClient() {
    switch (this.config.type) {
      case 'openai':
        const configuration = new Configuration({
          apiKey: this.config.apiKey,
          basePath: this.config.baseUrl
        })
        this.openai = new OpenAIApi(configuration)
        break

      case 'anthropic':
        this.claude = new Claude({
          apiKey: this.config.apiKey
        })
        break

      case 'deepseek':
        this.deepseekApi = this.config.baseUrl || 'https://api.deepseek.com/v1'
        break
    }
  }

  async generate(params: GenerationParams): Promise<string> {
    try {
      switch (this.config.type) {
        case 'openai':
          return await this.generateWithOpenAI(params)
        case 'anthropic':
          return await this.generateWithClaude(params)
        case 'deepseek':
          return await this.generateWithDeepseek(params)
        default:
          throw new Error('不支持的模型类型')
      }
    } catch (error) {
      console.error('模型调用失败:', error)
      throw error
    }
  }

  private async generateWithOpenAI(params: GenerationParams): Promise<string> {
    if (!this.openai) throw new Error('OpenAI客户端未初始化')

    const response = await this.openai.createChatCompletion({
      model: this.config.modelName,
      messages: [{ role: 'user', content: params.prompt }],
      max_tokens: params.maxTokens,
      temperature: params.temperature,
      top_p: params.topP,
      frequency_penalty: params.frequencyPenalty,
      presence_penalty: params.presencePenalty,
      stop: params.stop
    })

    return response.data.choices[0]?.message?.content || ''
  }

  private async generateWithClaude(params: GenerationParams): Promise<string> {
    if (!this.claude) throw new Error('Claude客户端未初始化')

    const response = await this.claude.complete({
      prompt: params.prompt,
      model: this.config.modelName,
      max_tokens_to_sample: params.maxTokens,
      temperature: params.temperature,
      top_p: params.topP,
      stop_sequences: params.stop
    })

    return response.completion
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
    switch (this.config.type) {
      case 'openai':
        if (!this.openai) throw new Error('OpenAI客户端未初始化')

        const stream = await this.openai.createChatCompletion({
          model: this.config.modelName,
          messages: [{ role: 'user', content: params.prompt }],
          stream: true,
          ...params
        })

        for await (const chunk of stream.data) {
          const content = chunk.choices[0]?.delta?.content
          if (content) yield content
        }
        break

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
