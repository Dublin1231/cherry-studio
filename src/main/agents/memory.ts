import { MilvusClient } from '@zilliz/milvus2-sdk-node'
import { DataType } from '@zilliz/milvus2-sdk-node'

import { novelService } from '../db/service'
import { BaseAgent } from './base'
import { createModel, ModelAPI } from './model-api'
import { AgentMessage, AgentResult, MemoryAgentConfig } from './types'

interface MemoryAnchor {
  id: string
  type: 'character' | 'location' | 'item' | 'event'
  content: string
  embedding: number[]
  relations: {
    causal?: string[]
    temporal?: string[]
    spatial?: string[]
  }
  weight: number
  chapterRange: [number, number]
  lastAccessed: Date
}

export class MemoryManager {
  private milvus: MilvusClient
  private model: ModelAPI

  constructor(config: any = {}) {
    this.milvus = new MilvusClient(config.milvusUrl || 'localhost:19530')
    this.model = createModel(
      config.model || {
        type: 'openai',
        modelName: 'text-embedding-ada-002'
      }
    )

    this.initializeCollections()
  }

  private async initializeCollections() {
    try {
      // 创建记忆锚点集合
      await this.milvus.createCollection({
        collection_name: 'memory_anchors',
        dimension: 1536, // OpenAI Ada 002 embedding维度
        description: '小说记忆锚点向量存储'
      })

      // 创建索引
      await this.milvus.createIndex({
        collection_name: 'memory_anchors',
        field_name: 'embedding',
        index_type: 'IVF_FLAT',
        metric_type: 'L2',
        params: { nlist: 1024 }
      })
    } catch (error) {
      console.error('初始化向量集合失败:', error)
    }
  }

  async getRelevantMemories(novelId: string, chapterNumber: number): Promise<any[]> {
    try {
      // 1. 获取当前章节的上下文范围
      const contextRange = this.calculateContextRange(chapterNumber)

      // 2. 从数据库获取相关章节的记忆锚点
      const memories = await novelService.getMemoryAnchors(novelId, contextRange.start, contextRange.end)

      // 3. 根据权重和时间衰减排序
      const sortedMemories = this.sortMemoriesByRelevance(memories, chapterNumber)

      // 4. 返回最相关的记忆
      return sortedMemories.slice(0, 50) // 限制返回数量
    } catch (error) {
      console.error('获取相关记忆失败:', error)
      return []
    }
  }

  async searchSimilarMemories(content: string, limit: number = 10): Promise<any[]> {
    try {
      // 1. 生成内容的向量表示
      const embedding = await this.generateEmbedding(content)

      // 2. 在向量数据库中搜索
      const searchResults = await this.milvus.search({
        collection_name: 'memory_anchors',
        vectors: [embedding],
        vector_type: DataType.FloatVector,
        limit,
        params: { nprobe: 16 }
      })

      // 3. 获取完整的记忆数据
      const ids = searchResults.results.map((r) => r.id)
      return await novelService.getMemoryAnchorsByIds(ids)
    } catch (error) {
      console.error('搜索相似记忆失败:', error)
      return []
    }
  }

  async createMemoryAnchor(data: {
    novelId: string
    chapterId: string
    type: string
    content: string
    weight?: number
  }): Promise<any> {
    try {
      // 1. 生成内容的向量表示
      const embedding = await this.generateEmbedding(data.content)

      // 2. 创建记忆锚点
      const memoryAnchor = await novelService.createMemoryAnchor({
        ...data,
        embedding: Buffer.from(new Float32Array(embedding).buffer)
      })

      // 3. 存储向量到Milvus
      await this.milvus.insert({
        collection_name: 'memory_anchors',
        data: [
          {
            id: memoryAnchor.id,
            embedding
          }
        ]
      })

      return memoryAnchor
    } catch (error) {
      console.error('创建记忆锚点失败:', error)
      throw error
    }
  }

  async updateMemoryWeight(id: string, weight: number): Promise<void> {
    try {
      await novelService.updateMemoryAnchor(id, { weight })
    } catch (error) {
      console.error('更新记忆权重失败:', error)
      throw error
    }
  }

  private calculateContextRange(currentChapter: number) {
    return {
      start: Math.max(1, currentChapter - 10), // 往前10章
      end: currentChapter - 1
    }
  }

  private sortMemoriesByRelevance(memories: any[], currentChapter: number): any[] {
    return memories.sort((a, b) => {
      const weightA = this.calculateMemoryScore(a, currentChapter)
      const weightB = this.calculateMemoryScore(b, currentChapter)
      return weightB - weightA
    })
  }

  private calculateMemoryScore(memory: any, currentChapter: number): number {
    const chapterDiff = currentChapter - memory.chapterNumber
    const timeDecay = Math.exp(-chapterDiff / 10) // 10章的衰减周期
    return memory.weight * timeDecay
  }

  private async generateEmbedding(text: string): Promise<number[]> {
    try {
      // 使用 OpenAI API 生成 embedding
      const response = await this.model.generate({
        prompt: text,
        maxTokens: 0 // 只需要embedding
      })

      // 将响应转换为数字数组
      return Array.isArray(response) ? response : new Array(1536).fill(0)
    } catch (error) {
      console.error('生成向量嵌入失败:', error)
      throw error
    }
  }

  async cleanup(): Promise<void> {
    try {
      // Milvus 2.x 不需要显式关闭连接
      this.milvus = null as any
    } catch (error) {
      console.error('清理记忆管理器资源失败:', error)
    }
  }
}

export class MemoryAgent extends BaseAgent {
  protected config: MemoryAgentConfig
  private vectorDB: any // TODO: 实现向量数据库连接
  private cache: Map<string, MemoryAnchor>

  constructor(config: MemoryAgentConfig) {
    super(config)
    this.config = config
    this.cache = new Map()
  }

  /**
   * 初始化记忆管家
   */
  public async init(): Promise<void> {
    try {
      // TODO: 初始化向量数据库连接
      this.on('message', this.handleMessage.bind(this))
    } catch (error: any) {
      console.error('记忆管家初始化失败:', error)
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
        case 'store_memory':
          return await this.storeMemory(message.payload)
        case 'query_memory':
          return await this.queryMemory(message.payload)
        case 'update_memory':
          return await this.updateMemory(message.payload)
        case 'delete_memory':
          return await this.deleteMemory(message.payload)
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
   * 存储记忆
   */
  private async storeMemory(payload: { anchor: MemoryAnchor }): Promise<AgentResult> {
    const { anchor } = payload

    try {
      // 存入向量数据库
      // TODO: 实现向量数据库存储

      // 更新缓存
      this.cache.set(anchor.id, anchor)

      return {
        success: true,
        data: { id: anchor.id }
      }
    } catch (error: any) {
      throw new Error(`记忆存储失败: ${error.message}`)
    }
  }

  /**
   * 查询记忆
   */
  private async queryMemory(payload: { query: string; context?: any }): Promise<AgentResult> {
    const { query } = payload

    try {
      // TODO: 实现向量相似度搜索
      // 使用query进行向量搜索
      const queryVector = await this.textToVector(query)
      const results: MemoryAnchor[] = await this.searchSimilarVectors(queryVector)

      // 更新访问时间
      results.forEach((anchor) => {
        anchor.lastAccessed = new Date()
        this.cache.set(anchor.id, anchor)
      })

      return {
        success: true,
        data: { results }
      }
    } catch (error: any) {
      throw new Error(`记忆查询失败: ${error.message}`)
    }
  }

  /**
   * 将文本转换为向量
   */
  private async textToVector(text: string): Promise<number[]> {
    // TODO: 实现文本到向量的转换
    console.log('Converting text to vector:', text)
    return new Array(this.config.vectorDbConfig.dimension).fill(0)
  }

  /**
   * 搜索相似向量
   */
  private async searchSimilarVectors(vector: number[]): Promise<MemoryAnchor[]> {
    // TODO: 实现向量相似度搜索
    console.log('Searching similar vectors for:', vector)
    return []
  }

  /**
   * 更新记忆
   */
  private async updateMemory(payload: { id: string; updates: Partial<MemoryAnchor> }): Promise<AgentResult> {
    const { id, updates } = payload

    try {
      const anchor = this.cache.get(id)
      if (!anchor) {
        throw new Error(`未找到记忆: ${id}`)
      }

      // 更新记忆
      const updatedAnchor = { ...anchor, ...updates }

      // TODO: 更新向量数据库

      // 更新缓存
      this.cache.set(id, updatedAnchor)

      return {
        success: true,
        data: { anchor: updatedAnchor }
      }
    } catch (error: any) {
      throw new Error(`记忆更新失败: ${error.message}`)
    }
  }

  /**
   * 删除记忆
   */
  private async deleteMemory(payload: { id: string }): Promise<AgentResult> {
    const { id } = payload

    try {
      // 从缓存中删除
      this.cache.delete(id)

      // TODO: 从向量数据库中删除

      return {
        success: true,
        data: { id }
      }
    } catch (error: any) {
      throw new Error(`记忆删除失败: ${error.message}`)
    }
  }

  /**
   * 清理资源
   */
  public async cleanup(): Promise<void> {
    // 清理缓存
    this.cache.clear()

    // TODO: 关闭向量数据库连接

    this.removeAllListeners()
  }
}
