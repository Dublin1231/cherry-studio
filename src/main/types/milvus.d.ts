declare module '@zilliz/milvus2-sdk-node' {
  export enum DataType {
    FloatVector = 'FloatVector'
  }

  export interface SearchResult {
    results: Array<{
      id: string
      score: number
    }>
  }

  export class MilvusClient {
    constructor(url: string)

    createCollection(params: { collection_name: string; dimension: number; description?: string }): Promise<void>

    createIndex(params: {
      collection_name: string
      field_name: string
      index_type: string
      metric_type: string
      params: any
    }): Promise<void>

    insert(params: {
      collection_name: string
      data: Array<{
        id: string
        embedding: number[] | Float32Array
      }>
    }): Promise<void>

    search(params: {
      collection_name: string
      vectors: Array<number[]>
      vector_type: DataType
      limit: number
      params?: any
    }): Promise<SearchResult>

    delete(params: { collection_name: string; ids: string[] }): Promise<void>

    dropCollection(params: { collection_name: string }): Promise<void>
  }
}
