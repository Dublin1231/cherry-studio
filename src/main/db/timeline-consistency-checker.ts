import { EventEmitter } from 'events'
import { v4 as uuidv4 } from 'uuid'

import { ErrorAnalyzer } from './error-analyzer'
import { IMLPredictor, mlPredictor, PredictionInput } from './ml-predictor'
import { prisma } from './prisma'
import { ConsistencyIssue, ConsistencyIssueInput } from './types'

interface TimelineEventRaw {
  id: string
  novelId: string
  chapterId: string
  description: string
  timestamp: Date
  duration?: number
  type: 'scene' | 'action' | 'dialogue' | 'narration'
  importance: 'high' | 'medium' | 'low'
  character_ids: string[]
  location?: string
  relatedEvents?: string[]
}

interface TimelineEvent {
  id: string
  novelId: string
  chapterId: string
  description: string
  timestamp: Date
  duration?: number
  type: 'scene' | 'action' | 'dialogue' | 'narration'
  importance: 'high' | 'medium' | 'low'
  characters: string[]
  location?: string
  relatedEvents?: string[]
}

interface TimelineRelation {
  sourceEventId: string
  targetEventId: string
  type: 'before' | 'after' | 'during' | 'overlaps'
  temporalDistance?: number // 时间间隔（分钟）
}

interface TimelineCheckConfig {
  checkParallelEvents: boolean // 是否检查并行事件
  checkCausality: boolean // 是否检查因果关系
  maxTimeGap: number // 最大允许的时间间隔（分钟）
  minTimeGap: number // 最小需要的时间间隔（分钟）
  validateCharacterPresence: boolean // 是否验证角色出现的合理性
}

interface TimelineAnalysis {
  events: TimelineEvent[]
  relations: TimelineRelation[]
  issues: ConsistencyIssue[]
  metrics: {
    totalEvents: number
    totalRelations: number
    averageGap: number
    maxGap: number
    parallelEventCount: number
  }
}

export class TimelineConsistencyChecker extends EventEmitter {
  private static instance: TimelineConsistencyChecker
  private errorAnalyzer: ErrorAnalyzer
  private mlPredictor: IMLPredictor

  private readonly DEFAULT_CONFIG: TimelineCheckConfig = {
    checkParallelEvents: true,
    checkCausality: true,
    maxTimeGap: 24 * 60, // 24小时
    minTimeGap: 5, // 5分钟
    validateCharacterPresence: true
  }

  private constructor(errorAnalyzer: ErrorAnalyzer, mlPredictor: IMLPredictor) {
    super()
    this.errorAnalyzer = errorAnalyzer
    this.mlPredictor = mlPredictor
  }

  static getInstance(errorAnalyzer: ErrorAnalyzer, mlPredictor: IMLPredictor): TimelineConsistencyChecker {
    if (!TimelineConsistencyChecker.instance) {
      TimelineConsistencyChecker.instance = new TimelineConsistencyChecker(errorAnalyzer, mlPredictor)
    }
    return TimelineConsistencyChecker.instance
  }

  async checkTimelineConsistency(
    novelId: string,
    config: Partial<TimelineCheckConfig> = {}
  ): Promise<TimelineAnalysis> {
    const finalConfig = { ...this.DEFAULT_CONFIG, ...config }
    const issues: ConsistencyIssue[] = []

    // 获取所有时间线事件
    const events = await this.getTimelineEvents(novelId)
    const relations = await this.getTimelineRelations(events.map((e) => e.id))

    // 执行各种检查
    const checks = [
      this.checkChronologicalOrder(events, relations),
      this.checkTimeGaps(events, relations, finalConfig),
      this.checkParallelEvents(events, relations, finalConfig),
      this.checkCharacterPresence(events, finalConfig),
      this.checkCausality(events, relations, finalConfig)
    ]

    const checkResults = await Promise.all(checks)
    issues.push(...checkResults.flat())

    // 使用 ML 预测器分析潜在问题
    const predictions = await this.analyzePotentialIssues(events, relations)
    issues.push(...predictions)

    // 计算时间线指标
    const metrics = this.calculateMetrics(events, relations)

    return {
      events,
      relations,
      issues,
      metrics
    }
  }

  private async getTimelineEvents(novelId: string): Promise<TimelineEvent[]> {
    // 从数据库获取时间线事件
    const events = await prisma.$queryRaw<TimelineEventRaw[]>`
      SELECT 
        te.*,
        array_agg(DISTINCT c.id) as character_ids
      FROM "TimelineEvent" te
      LEFT JOIN "_CharacterToTimelineEvent" cte ON te.id = cte."B"
      LEFT JOIN "Character" c ON cte."A" = c.id
      WHERE te."novelId" = ${novelId}
      GROUP BY te.id
      ORDER BY te.timestamp ASC
    `

    return events.map((event) => ({
      ...event,
      characters: event.character_ids,
      character_ids: undefined
    }))
  }

  private async getTimelineRelations(eventIds: string[]): Promise<TimelineRelation[]> {
    // 获取事件之间的关系
    return await prisma.$queryRaw<TimelineRelation[]>`
      SELECT *
      FROM "TimelineRelation"
      WHERE "sourceEventId" = ANY(${eventIds})
      OR "targetEventId" = ANY(${eventIds})
    `
  }

  private async checkChronologicalOrder(
    events: TimelineEvent[],
    relations: TimelineRelation[]
  ): Promise<ConsistencyIssue[]> {
    const issuePromises: Promise<ConsistencyIssue>[] = []

    // 检查时间顺序
    for (const [i, current] of events.entries()) {
      if (i === events.length - 1) continue
      const next = events[i + 1]

      if (current.timestamp > next.timestamp) {
        issuePromises.push(
          this.createConsistencyIssue({
            type: 'chronological_order',
            details: `时间顺序错误：${current.description} 发生在 ${next.description} 之后`,
            severity: 'high',
            autoFixable: true,
            fixSuggestion: '调整事件发生时间或顺序',
            metadata: {
              eventIds: [current.id, next.id]
            }
          })
        )
      }
    }

    // 检查关系一致性
    for (const relation of relations) {
      const source = events.find((e) => e.id === relation.sourceEventId)
      const target = events.find((e) => e.id === relation.targetEventId)

      if (!source || !target) continue

      if (relation.type === 'before' && source.timestamp >= target.timestamp) {
        issuePromises.push(
          this.createConsistencyIssue({
            type: 'relation_conflict',
            details: `关系冲突：${source.description} 应在 ${target.description} 之前发生`,
            severity: 'high',
            autoFixable: true,
            fixSuggestion: '修正事件时间或关系类型',
            metadata: {
              relationId: relation.sourceEventId + '_' + relation.targetEventId
            }
          })
        )
      }
    }

    return Promise.all(issuePromises)
  }

  private async checkTimeGaps(
    events: TimelineEvent[],
    relations: TimelineRelation[],
    config: TimelineCheckConfig
  ): Promise<ConsistencyIssue[]> {
    const issuePromises: Promise<ConsistencyIssue>[] = []

    // 检查相邻事件的时间间隔
    for (const [i, current] of events.entries()) {
      if (i === events.length - 1) continue
      const next = events[i + 1]
      const gap = (next.timestamp.getTime() - current.timestamp.getTime()) / (1000 * 60) // 转换为分钟

      if (gap > config.maxTimeGap) {
        issuePromises.push(
          this.createConsistencyIssue({
            type: 'large_time_gap',
            details: `事件间隔过大：${current.description} 和 ${next.description} 之间相差 ${Math.round(gap / 60)} 小时`,
            severity: 'medium',
            autoFixable: false,
            fixSuggestion: '考虑添加过渡事件或说明时间跨度',
            metadata: {
              gap,
              eventIds: [current.id, next.id]
            }
          })
        )
      }

      if (gap < config.minTimeGap && !this.areEventsParallel(current, next, relations)) {
        issuePromises.push(
          this.createConsistencyIssue({
            type: 'small_time_gap',
            details: `事件间隔过小：${current.description} 和 ${next.description} 之间间隔不足`,
            severity: 'low',
            autoFixable: true,
            fixSuggestion: '调整事件时间或标记为并行事件',
            metadata: {
              gap,
              eventIds: [current.id, next.id]
            }
          })
        )
      }
    }

    return Promise.all(issuePromises)
  }

  private async checkParallelEvents(
    events: TimelineEvent[],
    relations: TimelineRelation[],
    config: TimelineCheckConfig
  ): Promise<ConsistencyIssue[]> {
    if (!config.checkParallelEvents) return []

    const issues: ConsistencyIssue[] = []
    const parallelGroups = this.groupParallelEvents(events, relations)

    for (const group of parallelGroups) {
      // 检查角色冲突
      const characterConflicts = this.checkCharacterConflicts(group)
      issues.push(...characterConflicts)

      // 检查位置冲突
      const locationConflicts = this.checkLocationConflicts(group)
      issues.push(...locationConflicts)
    }

    return issues
  }

  private async checkCharacterPresence(
    events: TimelineEvent[],
    config: TimelineCheckConfig
  ): Promise<ConsistencyIssue[]> {
    if (!config.validateCharacterPresence) return []

    const issues: ConsistencyIssue[] = []
    const characterTimelines = new Map<string, TimelineEvent[]>()

    // 构建每个角色的时间线
    for (const event of events) {
      for (const characterId of event.characters) {
        if (!characterTimelines.has(characterId)) {
          characterTimelines.set(characterId, [])
        }
        characterTimelines.get(characterId)!.push(event)
      }
    }

    // 检查每个角色的时间线
    for (const [characterId, characterEvents] of characterTimelines) {
      // 检查不合理的移动
      const movementIssues = this.checkCharacterMovement(characterId, characterEvents)
      issues.push(...movementIssues)

      // 检查同时出现
      const presenceIssues = this.checkSimultaneousPresence(characterId, characterEvents, events)
      issues.push(...presenceIssues)
    }

    return issues
  }

  private async checkCausality(
    events: TimelineEvent[],
    relations: TimelineRelation[],
    config: TimelineCheckConfig
  ): Promise<ConsistencyIssue[]> {
    if (!config.checkCausality) return []

    const issues: ConsistencyIssue[] = []

    // 使用 ML 预测器分析因果关系
    const causalityPredictions = await this.mlPredictor.predict({
      type: 'causality',
      events: events.map((e) => ({
        id: e.id,
        description: e.description,
        type: e.type,
        timestamp: e.timestamp
      })),
      relations: relations
    })

    // 处理预测结果
    for (const prediction of causalityPredictions) {
      if (prediction.confidence > 0.8) {
        issues.push(
          await this.createConsistencyIssue({
            type: 'causality_issue',
            details: prediction.details,
            severity: prediction.severity as 'high' | 'medium' | 'low',
            autoFixable: false,
            fixSuggestion: prediction.suggestion,
            metadata: {
              prediction
            }
          })
        )
      }
    }

    return issues
  }

  private groupParallelEvents(events: TimelineEvent[], relations: TimelineRelation[]): TimelineEvent[][] {
    const groups: TimelineEvent[][] = []
    const processed = new Set<string>()

    for (const event of events) {
      if (processed.has(event.id)) continue

      const group = [event]
      processed.add(event.id)

      // 查找所有并行的事件
      const parallelEvents = this.findParallelEvents(event, events, relations)
      for (const parallelEvent of parallelEvents) {
        if (!processed.has(parallelEvent.id)) {
          group.push(parallelEvent)
          processed.add(parallelEvent.id)
        }
      }

      if (group.length > 1) {
        groups.push(group)
      }
    }

    return groups
  }

  private findParallelEvents(
    event: TimelineEvent,
    allEvents: TimelineEvent[],
    relations: TimelineRelation[]
  ): TimelineEvent[] {
    const parallelEvents: TimelineEvent[] = []

    for (const relation of relations) {
      if (relation.type === 'during' || relation.type === 'overlaps') {
        if (relation.sourceEventId === event.id) {
          const targetEvent = allEvents.find((e) => e.id === relation.targetEventId)
          if (targetEvent) parallelEvents.push(targetEvent)
        } else if (relation.targetEventId === event.id) {
          const sourceEvent = allEvents.find((e) => e.id === relation.sourceEventId)
          if (sourceEvent) parallelEvents.push(sourceEvent)
        }
      }
    }

    return parallelEvents
  }

  private checkCharacterConflicts(events: TimelineEvent[]): ConsistencyIssue[] {
    const issues: ConsistencyIssue[] = []
    const characterPresence = new Map<string, TimelineEvent[]>()

    // 收集每个角色在并行事件中的出现
    for (const event of events) {
      for (const characterId of event.characters) {
        if (!characterPresence.has(characterId)) {
          characterPresence.set(characterId, [])
        }
        characterPresence.get(characterId)!.push(event)
      }
    }

    // 检查冲突
    for (const [characterId, characterEvents] of characterPresence) {
      if (characterEvents.length > 1) {
        // 检查位置冲突
        const locations = new Set(characterEvents.map((e) => e.location).filter(Boolean))
        if (locations.size > 1) {
          issues.push(
            await this.createConsistencyIssue({
              type: 'character_location_conflict',
              details: `角色在同一时间出现在多个位置：${characterId}`,
              severity: 'high',
              autoFixable: true,
              fixSuggestion: '调整事件时间或修正角色出现位置',
              metadata: {
                characterId,
                eventIds: characterEvents.map((e) => e.id),
                locations: Array.from(locations)
              }
            })
          )
        }
      }
    }

    return issues
  }

  private checkLocationConflicts(events: TimelineEvent[]): ConsistencyIssue[] {
    const issues: ConsistencyIssue[] = []
    const locationEvents = new Map<string, TimelineEvent[]>()

    // 按位置分组事件
    for (const event of events) {
      if (event.location) {
        if (!locationEvents.has(event.location)) {
          locationEvents.set(event.location, [])
        }
        locationEvents.get(event.location)!.push(event)
      }
    }

    // 检查每个位置的事件冲突
    for (const [location, locationEvts] of locationEvents) {
      if (locationEvts.length > 1) {
        // 检查位置容量和事件兼容性
        const capacityIssues = this.checkLocationCapacity(location, locationEvts)
        issues.push(...capacityIssues)
      }
    }

    return issues
  }

  private checkLocationCapacity(location: string, events: TimelineEvent[]): ConsistencyIssue[] {
    const issues: ConsistencyIssue[] = []

    // 计算同时在场的角色数量
    const characters = new Set<string>()
    events.forEach((event) => event.characters.forEach((c) => characters.add(c)))

    // 假设每个位置都有一个最大容量限制
    const maxCapacity = this.getLocationCapacity(location)
    if (characters.size > maxCapacity) {
      issues.push(
        await this.createConsistencyIssue({
          type: 'location_capacity_exceeded',
          details: `位置容量超限：${location} 同时容纳了 ${characters.size} 个角色`,
          severity: 'medium',
          autoFixable: true,
          fixSuggestion: '考虑分散事件时间或更换更大的场地',
          metadata: {
            location,
            eventIds: events.map((e) => e.id),
            characterCount: characters.size,
            maxCapacity
          }
        })
      )
    }

    return issues
  }

  private getLocationCapacity(location: string): number {
    // 这里可以从配置或数据库中获取位置容量信息
    const defaultCapacity = 10
    return defaultCapacity
  }

  private checkCharacterMovement(characterId: string, events: TimelineEvent[]): ConsistencyIssue[] {
    const issues: ConsistencyIssue[] = []

    for (let i = 0; i < events.length - 1; i++) {
      const current = events[i]
      const next = events[i + 1]

      if (current.location && next.location && current.location !== next.location) {
        // 计算所需的移动时间
        const requiredTime = this.calculateTravelTime(current.location, next.location)
        const actualTime = (next.timestamp.getTime() - current.timestamp.getTime()) / (1000 * 60)

        if (actualTime < requiredTime) {
          issues.push(
            await this.createConsistencyIssue({
              type: 'impossible_movement',
              details: `角色移动时间不足：从 ${current.location} 到 ${next.location}`,
              severity: 'high',
              autoFixable: true,
              fixSuggestion: '增加事件之间的时间间隔或添加过渡场景',
              metadata: {
                characterId,
                fromLocation: current.location,
                toLocation: next.location,
                requiredTime,
                actualTime
              }
            })
          )
        }
      }
    }

    return issues
  }

  private calculateTravelTime(fromLocation: string, toLocation: string): number {
    // 这里可以实现更复杂的路径规划算法
    // 当前使用简单的固定时间
    return 30 // 假设需要30分钟
  }

  private checkSimultaneousPresence(
    characterId: string,
    characterEvents: TimelineEvent[],
    allEvents: TimelineEvent[]
  ): ConsistencyIssue[] {
    const issues: ConsistencyIssue[] = []

    for (const event of characterEvents) {
      // 查找同一时间的其他事件
      const simultaneousEvents = allEvents.filter(
        (e) => e.id !== event.id && Math.abs(e.timestamp.getTime() - event.timestamp.getTime()) < 1000 * 60 * 5 // 5分钟内
      )

      for (const simEvent of simultaneousEvents) {
        if (simEvent.characters.includes(characterId) && event.location !== simEvent.location) {
          issues.push(
            await this.createConsistencyIssue({
              type: 'simultaneous_presence',
              details: `角色同时出现在多个地点：${characterId}`,
              severity: 'high',
              autoFixable: true,
              fixSuggestion: '调整事件时间或修正角色出现位置',
              metadata: {
                characterId,
                events: [event.id, simEvent.id]
              }
            })
          )
        }
      }
    }

    return issues
  }

  private areEventsParallel(event1: TimelineEvent, event2: TimelineEvent, relations: TimelineRelation[]): boolean {
    return relations.some(
      (r) =>
        (r.type === 'during' || r.type === 'overlaps') &&
        ((r.sourceEventId === event1.id && r.targetEventId === event2.id) ||
          (r.sourceEventId === event2.id && r.targetEventId === event1.id))
    )
  }

  private async analyzePotentialIssues(
    events: TimelineEvent[],
    relations: TimelineRelation[]
  ): Promise<ConsistencyIssue[]> {
    const predictionInput: PredictionInput = {
      type: 'timeline_consistency',
      events: events.map((e) => ({
        id: e.id,
        description: e.description,
        type: e.type,
        timestamp: e.timestamp
      })),
      relations: relations
    }

    const predictions = await this.mlPredictor.predict(predictionInput)
    const issuePromises = predictions.map((prediction) =>
      this.createConsistencyIssue({
        type: 'potential_issue',
        details: prediction.details,
        severity: prediction.severity as 'high' | 'medium' | 'low',
        autoFixable: false,
        fixSuggestion: prediction.suggestion,
        metadata: {
          prediction
        }
      })
    )

    return Promise.all(issuePromises)
  }

  private calculateMetrics(events: TimelineEvent[], relations: TimelineRelation[]): TimelineAnalysis['metrics'] {
    let totalGap = 0
    let maxGap = 0
    let parallelEventCount = 0

    // 计算时间间隔
    for (let i = 0; i < events.length - 1; i++) {
      const gap = (events[i + 1].timestamp.getTime() - events[i].timestamp.getTime()) / (1000 * 60)
      totalGap += gap
      maxGap = Math.max(maxGap, gap)
    }

    // 计算并行事件数量
    const parallelGroups = this.groupParallelEvents(events, relations)
    parallelEventCount = parallelGroups.reduce((sum, group) => sum + group.length, 0)

    return {
      totalEvents: events.length,
      totalRelations: relations.length,
      averageGap: events.length > 1 ? totalGap / (events.length - 1) : 0,
      maxGap,
      parallelEventCount
    }
  }

  private async createConsistencyIssue(input: ConsistencyIssueInput): Promise<ConsistencyIssue> {
    const now = new Date()
    return {
      id: uuidv4(),
      description: input.details, // 使用details作为description
      status: 'open',
      createdAt: now,
      updatedAt: now,
      ...input
    }
  }
}

// 导出单例实例
export const timelineConsistencyChecker = TimelineConsistencyChecker.getInstance(
  ErrorAnalyzer.getInstance(),
  mlPredictor
)
