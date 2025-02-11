import { EventEmitter } from 'events'

interface CompressionConfig {
  method: 'pq' | 'sq' | 'ivfpq'
  params: {
    nlist?: number // IVF 聚类中心数量
    nsubvector?: number // PQ 子向量数量
    nbits?: number // 量化位数
  }
  threshold: {
    dimension: number // 压缩维度阈值
    dataSize: number // 数据大小阈值(MB)
  }
}

interface CompressionMetrics {
  originalSize: number
  compressedSize: number
  compressionRatio: number
  accuracy: number
  speed: number
}

export class VectorCompressor extends EventEmitter {
  private static instance: VectorCompressor
  private configs: Map<string, CompressionConfig> = new Map()
  private metrics: Map<string, CompressionMetrics> = new Map()

  private readonly DEFAULT_CONFIG: CompressionConfig = {
    method: 'pq',
    params: {
      nsubvector: 8,
      nbits: 8
    },
    threshold: {
      dimension: 256,
      dataSize: 100 // MB
    }
  }

  private constructor() {
    super()
    this.initializeConfigs()
  }

  static getInstance(): VectorCompressor {
    if (!VectorCompressor.instance) {
      VectorCompressor.instance = new VectorCompressor()
    }
    return VectorCompressor.instance
  }

  private initializeConfigs() {
    // PQ (Product Quantization) - 适用于高维向量
    this.configs.set('pq', {
      method: 'pq',
      params: {
        nsubvector: 8, // 将向量分成8个子向量
        nbits: 8 // 每个子向量使用8位量化
      },
      threshold: {
        dimension: 256,
        dataSize: 100
      }
    })

    // SQ (Scalar Quantization) - 适用于低维向量
    this.configs.set('sq', {
      method: 'sq',
      params: {
        nbits: 8 // 使用8位量化
      },
      threshold: {
        dimension: 64,
        dataSize: 50
      }
    })

    // IVF-PQ - 适用于大规模数据集
    this.configs.set('ivfpq', {
      method: 'ivfpq',
      params: {
        nlist: 1024, // IVF聚类中心数量
        nsubvector: 16,
        nbits: 8
      },
      threshold: {
        dimension: 512,
        dataSize: 1000
      }
    })
  }

  async compress(
    vectors: number[][],
    options: {
      method?: 'pq' | 'sq' | 'ivfpq'
      params?: Partial<CompressionConfig['params']>
    } = {}
  ): Promise<{
    compressed: Uint8Array
    metrics: CompressionMetrics
  }> {
    const startTime = Date.now()
    const method = options.method || this.selectMethod(vectors)
    const config = this.getConfig(method, options.params)

    try {
      const originalSize = this.calculateSize(vectors)
      let compressed: Uint8Array

      switch (method) {
        case 'pq':
          compressed = await this.compressPQ(vectors, config)
          break
        case 'sq':
          compressed = await this.compressSQ(vectors, config)
          break
        case 'ivfpq':
          compressed = await this.compressIVFPQ(vectors, config)
          break
        default:
          throw new Error(`不支持的压缩方法: ${method}`)
      }

      const compressedSize = compressed.byteLength
      const metrics = {
        originalSize,
        compressedSize,
        compressionRatio: originalSize / compressedSize,
        accuracy: await this.evaluateAccuracy(vectors, compressed, method),
        speed: vectors.length / ((Date.now() - startTime) / 1000)
      }

      this.updateMetrics(method, metrics)
      this.emit('compression_completed', { method, metrics })

      return { compressed, metrics }
    } catch (error) {
      this.emit('compression_failed', { method, error })
      throw error
    }
  }

  private selectMethod(vectors: number[][]): 'pq' | 'sq' | 'ivfpq' {
    const dimension = vectors[0]?.length || 0
    const dataSize = this.calculateSize(vectors)

    // 根据数据特征选择最佳压缩方法
    if (dimension >= 512 && dataSize >= 1000) {
      return 'ivfpq' // 高维大规模数据
    } else if (dimension >= 256) {
      return 'pq' // 高维数据
    } else {
      return 'sq' // 低维数据
    }
  }

  private getConfig(method: 'pq' | 'sq' | 'ivfpq', params?: Partial<CompressionConfig['params']>): CompressionConfig {
    const baseConfig = this.configs.get(method) || this.DEFAULT_CONFIG
    return {
      ...baseConfig,
      params: { ...baseConfig.params, ...params }
    }
  }

  private calculateSize(vectors: number[][]): number {
    // 假设每个浮点数占用4字节
    return (vectors.length * vectors[0]?.length * 4) / (1024 * 1024) // 转换为MB
  }

  private async compressPQ(vectors: number[][], config: CompressionConfig): Promise<Uint8Array> {
    const { nsubvector = 8, nbits = 8 } = config.params
    // 实现Product Quantization压缩
    // 1. 将向量分割为nsubvector个子向量
    // 2. 对每个子向量空间进行k-means聚类
    // 3. 用聚类中心的索引替换原始子向量
    // 这里使用模拟实现
    return new Uint8Array(vectors.length * nsubvector)
  }

  private async compressSQ(vectors: number[][], config: CompressionConfig): Promise<Uint8Array> {
    const { nbits = 8 } = config.params
    // 实现Scalar Quantization压缩
    // 1. 找到每个维度的最大值和最小值
    // 2. 将每个维度的值线性映射到[0, 2^nbits-1]
    // 这里使用模拟实现
    return new Uint8Array(vectors.length * vectors[0].length)
  }

  private async compressIVFPQ(vectors: number[][], config: CompressionConfig): Promise<Uint8Array> {
    const { nlist = 1024, nsubvector = 16, nbits = 8 } = config.params
    // 实现IVF-PQ压缩
    // 1. 使用k-means进行粗量化,得到nlist个聚类中心
    // 2. 对每个聚类内的残差向量进行PQ压缩
    // 这里使用模拟实现
    return new Uint8Array(vectors.length * (4 + nsubvector)) // 4字节存储聚类索引
  }

  private async evaluateAccuracy(original: number[][], compressed: Uint8Array, method: string): Promise<number> {
    // 实现压缩准确性评估
    // 1. 解压缩向量
    // 2. 计算原始向量和解压缩向量的余弦相似度
    // 3. 返回平均相似度
    // 这里返回模拟值
    return 0.95
  }

  private updateMetrics(method: string, metrics: CompressionMetrics): void {
    this.metrics.set(method, metrics)
  }

  getMetrics(method: string): CompressionMetrics | undefined {
    return this.metrics.get(method)
  }

  getAllMetrics(): Map<string, CompressionMetrics> {
    return new Map(this.metrics)
  }

  getSupportedMethods(): string[] {
    return Array.from(this.configs.keys())
  }

  getMethodConfig(method: string): CompressionConfig | undefined {
    return this.configs.get(method)
  }
}

export const vectorCompressor = VectorCompressor.getInstance()
