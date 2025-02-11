import { EventEmitter } from 'events'
import { Foreshadowing } from '../db/types'

interface VisualizationConfig {
  layout: 'timeline' | 'network' | 'tree'
  showImportance: boolean
  showStatus: boolean
  showRelations: boolean
  colorScheme: 'light' | 'dark'
}

interface VisualizationData {
  nodes: Array<{
    id: string
    label: string
    type: 'setup' | 'payoff'
    importance: 'high' | 'medium' | 'low'
    status: 'active' | 'resolved'
    chapter: number
    position: { x: number; y: number }
  }>
  edges: Array<{
    source: string
    target: string
    type: 'setup_payoff' | 'related'
    strength: number
  }>
}

export class ForeshadowingVisualizer extends EventEmitter {
  private static instance: ForeshadowingVisualizer
  private config: VisualizationConfig
  private data: VisualizationData = { nodes: [], edges: [] }

  private constructor() {
    super()
    this.config = {
      layout: 'timeline',
      showImportance: true,
      showStatus: true,
      showRelations: true,
      colorScheme: 'light'
    }
  }

  static getInstance(): ForeshadowingVisualizer {
    if (!ForeshadowingVisualizer.instance) {
      ForeshadowingVisualizer.instance = new ForeshadowingVisualizer()
    }
    return ForeshadowingVisualizer.instance
  }

  // 更新可视化配置
  setConfig(config: Partial<VisualizationConfig>): void {
    this.config = { ...this.config, ...config }
    this.emit('config_updated', this.config)
  }

  // 加载伏笔数据
  async loadForeshadowings(foreshadowings: Foreshadowing[]): Promise<void> {
    this.data = this.transformData(foreshadowings)
    this.emit('data_loaded', this.data)
  }

  // 转换数据为可视化格式
  private transformData(foreshadowings: Foreshadowing[]): VisualizationData {
    const nodes = foreshadowings.map((f) => ({
      id: f.id,
      label: f.description,
      type: 'setup' as const,
      importance: f.importance,
      status: f.status === 'resolved' ? 'resolved' : 'active',
      chapter: this.getChapterNumber(f.setupChapterId),
      position: this.calculatePosition(f)
    }))

    const edges = this.generateEdges(foreshadowings)

    return { nodes, edges }
  }

  // 生成节点间的连接
  private generateEdges(foreshadowings: Foreshadowing[]): VisualizationData['edges'] {
    const edges: VisualizationData['edges'] = []

    // 创建伏笔之间的关联
    foreshadowings.forEach((f1) => {
      foreshadowings.forEach((f2) => {
        if (f1.id !== f2.id && this.areRelated(f1, f2)) {
          edges.push({
            source: f1.id,
            target: f2.id,
            type: 'related',
            strength: this.calculateRelationStrength(f1, f2)
          })
        }
      })
    })

    return edges
  }

  // 计算节点位置
  private calculatePosition(foreshadowing: Foreshadowing): { x: number; y: number } {
    switch (this.config.layout) {
      case 'timeline':
        return this.calculateTimelinePosition(foreshadowing)
      case 'network':
        return this.calculateNetworkPosition(foreshadowing)
      case 'tree':
        return this.calculateTreePosition(foreshadowing)
      default:
        return { x: 0, y: 0 }
    }
  }

  // 计算时间线布局位置
  private calculateTimelinePosition(foreshadowing: Foreshadowing): { x: number; y: number } {
    const chapter = this.getChapterNumber(foreshadowing.setupChapterId)
    return {
      x: chapter * 100, // 水平位置基于章节
      y: this.getImportanceLevel(foreshadowing.importance) * 100 // 垂直位置基于重要性
    }
  }

  // 计算网络布局位置
  private calculateNetworkPosition(foreshadowing: Foreshadowing): { x: number; y: number } {
    // 使用力导向算法计算位置
    return { x: Math.random() * 1000, y: Math.random() * 1000 }
  }

  // 计算树形布局位置
  private calculateTreePosition(foreshadowing: Foreshadowing): { x: number; y: number } {
    // 基于层级关系计算位置
    const level = this.getTreeLevel(foreshadowing)
    return {
      x: level * 200,
      y: this.getVerticalPosition(foreshadowing) * 100
    }
  }

  // 判断两个伏笔是否相关
  private areRelated(f1: Foreshadowing, f2: Foreshadowing): boolean {
    // 检查角色重叠
    const hasCommonCharacters = f1.relatedCharacters.some((char) => f2.relatedCharacters.includes(char))
    // 检查类型关联
    const hasTypeRelation = f1.type === f2.type
    // 检查时间接近度
    const isTemporallyClose = Math.abs(
      this.getChapterNumber(f1.setupChapterId) - this.getChapterNumber(f2.setupChapterId)
    ) <= 5

    return hasCommonCharacters || (hasTypeRelation && isTemporallyClose)
  }

  // 计算关联强度
  private calculateRelationStrength(f1: Foreshadowing, f2: Foreshadowing): number {
    let strength = 0

    // 基于共同角色数量
    const commonCharacters = f1.relatedCharacters.filter((char) => f2.relatedCharacters.includes(char))
    strength += commonCharacters.length * 0.2

    // 基于类型关联
    if (f1.type === f2.type) strength += 0.3

    // 基于时间接近度
    const chapterDiff = Math.abs(
      this.getChapterNumber(f1.setupChapterId) - this.getChapterNumber(f2.setupChapterId)
    )
    strength += Math.max(0, 1 - chapterDiff / 10)

    // 基于重要性
    if (f1.importance === f2.importance) strength += 0.2

    return Math.min(1, strength)
  }

  // 获取章节编号
  private getChapterNumber(chapterId: string): number {
    return parseInt(chapterId.split('-')[1]) || 0
  }

  // 获取重要性层级
  private getImportanceLevel(importance: 'high' | 'medium' | 'low'): number {
    switch (importance) {
      case 'high':
        return 0
      case 'medium':
        return 1
      case 'low':
        return 2
      default:
        return 1
    }
  }

  // 获取树形层级
  private getTreeLevel(foreshadowing: Foreshadowing): number {
    // 基于伏笔类型和状态计算层级
    let level = 0
    if (foreshadowing.type === 'character') level += 1
    if (foreshadowing.type === 'plot') level += 2
    if (foreshadowing.status === 'resolved') level += 1
    return level
  }

  // 获取垂直位置
  private getVerticalPosition(foreshadowing: Foreshadowing): number {
    return this.getImportanceLevel(foreshadowing.importance) + 
           (foreshadowing.status === 'resolved' ? 0.5 : 0)
  }

  // 导出可视化数据
  exportVisualization(): VisualizationData {
    return this.data
  }

  // 获取当前配置
  getConfig(): VisualizationConfig {
    return this.config
  }
}

// 导出单例实例
export const foreshadowingVisualizer = ForeshadowingVisualizer.getInstance() 