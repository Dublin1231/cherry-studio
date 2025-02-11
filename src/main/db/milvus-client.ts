import { MilvusClient } from '@zilliz/milvus2-sdk-node'

import { performanceMonitor } from '../utils/performance-monitor'

interface MilvusConfig {
  address: string
  username?: string
  password?: string
  ssl?: boolean
  maxRetries?: number
  retryDelay?: number
}

interface SearchParams {
  collection_name: string
  vector: number[]
  limit?: number
  offset?: number
  filter?: string
  output_fields?: string[]
  metric_type?: 'L2' | 'IP' | 'COSINE'
}

interface IndexParams {
  collection_name: string
  field_name: string
  index_type: 'IVF_FLAT' | 'IVF_SQ8' | 'IVF_PQ' | 'HNSW' | 'ANNOY'
  metric_type: 'L2' | 'IP' | 'COSINE'
  params: Record<string, any>
}

class MilvusClientWrapper {
  private client: MilvusClient
  private config: MilvusConfig
  private static instance: MilvusClientWrapper

  private constructor(config: MilvusConfig) {
    this.config = config
    this.client = new MilvusClient(config)
  }

  static getInstance(config: MilvusConfig): MilvusClientWrapper {
    if (!MilvusClientWrapper.instance) {
      MilvusClientWrapper.instance = new MilvusClientWrapper(config)
    }
    return MilvusClientWrapper.instance
  }

  async search(params: SearchParams): Promise<any[]> {
    return performanceMonitor.measure('milvus_search', async () => {
      try {
        const response = await this.client.search({
          collection_name: params.collection_name,
          vector: params.vector,
          limit: params.limit || 10,
          offset: params.offset || 0,
          filter: params.filter,
          output_fields: params.output_fields,
          metric_type: params.metric_type || 'L2'
        })
        return response.results
      } catch (error) {
        console.error('Milvus search error:', error)
        throw error
      }
    })
  }

  async createIndex(params: IndexParams): Promise<void> {
    return performanceMonitor.measure('milvus_create_index', async () => {
      try {
        await this.client.createIndex({
          collection_name: params.collection_name,
          field_name: params.field_name,
          extra_params: {
            index_type: params.index_type,
            metric_type: params.metric_type,
            params: params.params
          }
        })
      } catch (error) {
        console.error('Milvus create index error:', error)
        throw error
      }
    })
  }

  async dropIndex(collectionName: string, fieldName: string): Promise<void> {
    return performanceMonitor.measure('milvus_drop_index', async () => {
      try {
        await this.client.dropIndex({
          collection_name: collectionName,
          field_name: fieldName
        })
      } catch (error) {
        console.error('Milvus drop index error:', error)
        throw error
      }
    })
  }

  async insert(collectionName: string, data: any[]): Promise<void> {
    return performanceMonitor.measure('milvus_insert', async () => {
      try {
        await this.client.insert({
          collection_name: collectionName,
          data
        })
      } catch (error) {
        console.error('Milvus insert error:', error)
        throw error
      }
    })
  }

  async delete(collectionName: string, ids: string[]): Promise<void> {
    return performanceMonitor.measure('milvus_delete', async () => {
      try {
        await this.client.delete({
          collection_name: collectionName,
          ids
        })
      } catch (error) {
        console.error('Milvus delete error:', error)
        throw error
      }
    })
  }

  async createCollection(params: any): Promise<void> {
    return performanceMonitor.measure('milvus_create_collection', async () => {
      try {
        await this.client.createCollection(params)
      } catch (error) {
        console.error('Milvus create collection error:', error)
        throw error
      }
    })
  }

  async dropCollection(collectionName: string): Promise<void> {
    return performanceMonitor.measure('milvus_drop_collection', async () => {
      try {
        await this.client.dropCollection({
          collection_name: collectionName
        })
      } catch (error) {
        console.error('Milvus drop collection error:', error)
        throw error
      }
    })
  }

  async getCollectionInfo(collectionName: string): Promise<any> {
    return performanceMonitor.measure('milvus_get_collection_info', async () => {
      try {
        return await this.client.describeCollection({
          collection_name: collectionName
        })
      } catch (error) {
        console.error('Milvus get collection info error:', error)
        throw error
      }
    })
  }

  async listCollections(): Promise<string[]> {
    return performanceMonitor.measure('milvus_list_collections', async () => {
      try {
        const response = await this.client.listCollections()
        return response.collection_names
      } catch (error) {
        console.error('Milvus list collections error:', error)
        throw error
      }
    })
  }

  async flush(collectionName: string): Promise<void> {
    return performanceMonitor.measure('milvus_flush', async () => {
      try {
        await this.client.flush({
          collection_names: [collectionName]
        })
      } catch (error) {
        console.error('Milvus flush error:', error)
        throw error
      }
    })
  }

  async compact(collectionName: string): Promise<void> {
    return performanceMonitor.measure('milvus_compact', async () => {
      try {
        await this.client.compact({
          collection_name: collectionName
        })
      } catch (error) {
        console.error('Milvus compact error:', error)
        throw error
      }
    })
  }
}

// 创建单例实例
export const milvusClient = MilvusClientWrapper.getInstance({
  address: process.env.MILVUS_ADDRESS || 'localhost:19530',
  username: process.env.MILVUS_USERNAME,
  password: process.env.MILVUS_PASSWORD,
  ssl: process.env.MILVUS_SSL === 'true',
  maxRetries: 3,
  retryDelay: 1000
})
