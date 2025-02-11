import { EventEmitter } from 'events'
import { Foreshadowing } from '../db/types'

interface AnalysisResult {
  correlations: Array<{
    source: string
    target: string
    strength: number
    type: 'character' | 'plot' | 'theme'
    details: string[]
  }>
  clusters: Array<{
    id: string
    foreshadowings: string[]
    theme: string
    strength: number
  }>
  metrics: {
    averageCorrelation: number
    strongestCorrelation: number
    clusterCount: number
    isolatedCount: number
  }
}

interface AnalysisConfig {
  minCorrelation: number // 最小关联强度阈值
  maxDistance: number // 最大章节距离
  enableClustering: boolean // 是否启用聚类分析
  considerCharacters: boolean // 是否考虑角色关联
  considerThemes: boolean // 是否考虑主题关联
}

export class ForeshadowingAnalyzer extends EventEmitter {
  private static instance: ForeshadowingAnalyzer
  private config: AnalysisConfig
  private lastAnalysis: AnalysisResult | null = null

  private constructor() {
    super()
    this.config = {
      minCorrelation: 0.3,
      maxDistance: 20,
      enableClustering: true,
      considerCharacters: true,
      considerThemes: true
    }
  }

  static getInstance(): ForeshadowingAnalyzer {
    if (!ForeshadowingAnalyzer.instance) {
      ForeshadowingAnalyzer.instance = new ForeshadowingAnalyzer()
    }
    return ForeshadowingAnalyzer.instance
  }

  // 分析伏笔关联
  async analyzeForeshadowings(foreshadowings: Foreshadowing[]): Promise<AnalysisResult> {
    const correlations = this.findCorrelations(foreshadowings)
    const clusters = this.config.enableClustering ? this.clusterForeshadowings(correlations) : []
    
    const metrics = this.calculateMetrics(correlations, clusters, foreshadowings.length)
    
    this.lastAnalysis = {
      correlations,
      clusters,
      metrics
    }

    this.emit('analysis_complete', this.lastAnalysis)
    return this.lastAnalysis
  }

  // 查找伏笔间的关联
  private findCorrelations(foreshadowings: Foreshadowing[]): AnalysisResult['correlations'] {
    const correlations: AnalysisResult['correlations'] = []

    for (let i = 0; i < foreshadowings.length; i++) {
      for (let j = i + 1; j < foreshadowings.length; j++) {
        const source = foreshadowings[i]
        const target = foreshadowings[j]
        
        const correlation = this.calculateCorrelation(source, target)
        if (correlation.strength >= this.config.minCorrelation) {
          correlations.push(correlation)
        }
      }
    }

    return correlations
  }

  // 计算两个伏笔之间的关联度
  private calculateCorrelation(source: Foreshadowing, target: Foreshadowing): AnalysisResult['correlations'][0] {
    let strength = 0
    const details: string[] = []

    // 检查角色关联
    if (this.config.considerCharacters) {
      const commonCharacters = source.relatedCharacters.filter(char => 
        target.relatedCharacters.includes(char)
      )
      if (commonCharacters.length > 0) {
        strength += 0.3 * (commonCharacters.length / Math.max(source.relatedCharacters.length, target.relatedCharacters.length))
        details.push(`共同角色: ${commonCharacters.join(', ')}`)
      }
    }

    // 检查主题关联
    if (this.config.considerThemes) {
      if (source.type === target.type) {
        strength += 0.3
        details.push(`相同类型: ${source.type}`)
      }
    }

    // 检查章节距离
    const distance = Math.abs(
      this.getChapterNumber(source.setupChapterId) - 
      this.getChapterNumber(target.setupChapterId)
    )
    if (distance <= this.config.maxDistance) {
      strength += 0.4 * (1 - distance / this.config.maxDistance)
      details.push(`章节距离: ${distance}`)
    }

    // 检查重要性关联
    if (source.importance === target.importance) {
      strength += 0.2
      details.push(`相同重要性: ${source.importance}`)
    }

    return {
      source: source.id,
      target: target.id,
      strength: Math.min(1, strength),
      type: this.determineCorrelationType(source, target),
      details
    }
  }

  // 确定关联类型
  private determineCorrelationType(source: Foreshadowing, target: Foreshadowing): 'character' | 'plot' | 'theme' {
    if (source.type === target.type) {
      return source.type as 'character' | 'plot'
    }
    return 'theme'
  }

  // 聚类分析
  private clusterForeshadowings(correlations: AnalysisResult['correlations']): AnalysisResult['clusters'] {
    const clusters: AnalysisResult['clusters'] = []
    const visited = new Set<string>()

    correlations.forEach(correlation => {
      if (!visited.has(correlation.source)) {
        const cluster = this.expandCluster(correlation.source, correlations)
        if (cluster.foreshadowings.length > 1) {
          clusters.push({
            id: `cluster-${clusters.length + 1}`,
            foreshadowings: cluster.foreshadowings,
            theme: cluster.theme,
            strength: cluster.strength
          })
          cluster.foreshadowings.forEach(id => visited.add(id))
        }
      }
    })

    return clusters
  }

  // 扩展聚类
  private expandCluster(startId: string, correlations: AnalysisResult['correlations']): {
    foreshadowings: string[]
    theme: string
    strength: number
  } {
    const cluster = new Set<string>([startId])
    let totalStrength = 0
    let correlationCount = 0

    const queue = [startId]
    while (queue.length > 0) {
      const current = queue.shift()!
      correlations
        .filter(c => (c.source === current || c.target === current) && c.strength >= this.config.minCorrelation)
        .forEach(c => {
          const other = c.source === current ? c.target : c.source
          if (!cluster.has(other)) {
            cluster.add(other)
            queue.push(other)
            totalStrength += c.strength
            correlationCount++
          }
        })
    }

    return {
      foreshadowings: Array.from(cluster),
      theme: this.inferClusterTheme(Array.from(cluster), correlations),
      strength: correlationCount > 0 ? totalStrength / correlationCount : 0
    }
  }

  // 推断聚类主题
  private inferClusterTheme(clusterIds: string[], correlations: AnalysisResult['correlations']): string {
    const typeCount = new Map<string, number>()
    
    correlations
      .filter(c => clusterIds.includes(c.source) || clusterIds.includes(c.target))
      .forEach(c => {
        typeCount.set(c.type, (typeCount.get(c.type) || 0) + 1)
      })

    let maxCount = 0
    let dominantType = 'theme'
    typeCount.forEach((count, type) => {
      if (count > maxCount) {
        maxCount = count
        dominantType = type
      }
    })

    return dominantType
  }

  // 计算分析指标
  private calculateMetrics(
    correlations: AnalysisResult['correlations'],
    clusters: AnalysisResult['clusters'],
    totalCount: number
  ): AnalysisResult['metrics'] {
    const strengths = correlations.map(c => c.strength)
    const averageCorrelation = strengths.length > 0 
      ? strengths.reduce((sum, s) => sum + s, 0) / strengths.length 
      : 0

    const strongestCorrelation = strengths.length > 0 
      ? Math.max(...strengths) 
      : 0

    const clusterCount = clusters.length
    const clusteredIds = new Set(clusters.flatMap(c => c.foreshadowings))
    const isolatedCount = totalCount - clusteredIds.size

    return {
      averageCorrelation,
      strongestCorrelation,
      clusterCount,
      isolatedCount
    }
  }

  // 获取章节编号
  private getChapterNumber(chapterId: string): number {
    return parseInt(chapterId.split('-')[1]) || 0
  }

  // 更新配置
  setConfig(config: Partial<AnalysisConfig>): void {
    this.config = { ...this.config, ...config }
    this.emit('config_updated', this.config)
  }

  // 获取最后的分析结果
  getLastAnalysis(): AnalysisResult | null {
    return this.lastAnalysis
  }

  // 获取当前配置
  getConfig(): AnalysisConfig {
    return this.config
  }
}

// 导出单例实例
export const foreshadowingAnalyzer = ForeshadowingAnalyzer.getInstance() 