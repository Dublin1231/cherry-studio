import { EventEmitter } from 'events'
import { v4 as uuidv4 } from 'uuid'

import { ErrorAnalyzer } from './error-analyzer'
import { IMLPredictor, mlPredictor, PredictionInput } from './ml-predictor'
import { prisma } from './prisma'
import { ConsistencyIssue, ConsistencyIssueInput } from './types'

interface CharacterBehavior {
  id: string
  characterId: string
  novelId: string
  chapterId: string
  type: 'action' | 'dialogue' | 'emotion' | 'decision'
  description: string
  context: string
  timestamp: Date
  location?: string
  relatedCharacters?: string[]
  metadata?: Record<string, any>
}

interface WorldRule {
  id: string
  novelId: string
  category: 'physics' | 'magic' | 'society' | 'culture'
  name: string
  description: string
  constraints: string[]
  exceptions?: string[]
  priority: 'high' | 'medium' | 'low'
}

interface PlotElement {
  id: string
  novelId: string
  chapterId: string
  type: 'event' | 'revelation' | 'conflict' | 'resolution'
  description: string
  importance: 'high' | 'medium' | 'low'
  relatedElements?: string[]
  setup?: string
  payoff?: string
  status: 'setup' | 'development' | 'resolved'
}

interface BehaviorCheckConfig {
  validatePersonality: boolean
  validateRelationships: boolean
  validateMotivations: boolean
  validateGrowth: boolean
  validateWorldRules: boolean
  validatePlotLogic: boolean
}

export class BehaviorConsistencyChecker extends EventEmitter {
  private static instance: BehaviorConsistencyChecker
  private errorAnalyzer: ErrorAnalyzer
  private mlPredictor: IMLPredictor

  private readonly DEFAULT_CONFIG: BehaviorCheckConfig = {
    validatePersonality: true,
    validateRelationships: true,
    validateMotivations: true,
    validateGrowth: true,
    validateWorldRules: true,
    validatePlotLogic: true
  }

  private constructor(errorAnalyzer: ErrorAnalyzer, mlPredictor: IMLPredictor) {
    super()
    this.errorAnalyzer = errorAnalyzer
    this.mlPredictor = mlPredictor
  }

  static getInstance(errorAnalyzer: ErrorAnalyzer, mlPredictor: IMLPredictor): BehaviorConsistencyChecker {
    if (!BehaviorConsistencyChecker.instance) {
      BehaviorConsistencyChecker.instance = new BehaviorConsistencyChecker(errorAnalyzer, mlPredictor)
    }
    return BehaviorConsistencyChecker.instance
  }

  async checkBehaviorConsistency(
    novelId: string,
    chapterId: string,
    config: Partial<BehaviorCheckConfig> = {}
  ): Promise<ConsistencyIssue[]> {
    const finalConfig = { ...this.DEFAULT_CONFIG, ...config }
    const issues: ConsistencyIssue[] = []

    // 获取所有需要的数据
    const [behaviors, worldRules, plotElements] = await Promise.all([
      this.getCharacterBehaviors(novelId, chapterId),
      this.getWorldRules(novelId),
      this.getPlotElements(novelId, chapterId)
    ])

    // 执行各种检查
    const checks = [
      this.checkPersonalityConsistency(behaviors, finalConfig),
      this.checkRelationshipConsistency(behaviors, finalConfig),
      this.checkMotivationConsistency(behaviors, finalConfig),
      this.checkCharacterGrowth(behaviors, finalConfig),
      this.checkWorldRuleCompliance(behaviors, worldRules, finalConfig),
      this.checkPlotLogic(behaviors, plotElements, finalConfig)
    ]

    const checkResults = await Promise.all(checks)
    issues.push(...checkResults.flat())

    // 使用 ML 预测器分析潜在问题
    const predictions = await this.analyzePotentialIssues(behaviors, worldRules, plotElements)
    issues.push(...predictions)

    return issues
  }

  private async getCharacterBehaviors(novelId: string, chapterId: string): Promise<CharacterBehavior[]> {
    // 从数据库获取角色行为数据
    return await prisma.$queryRaw<CharacterBehavior[]>`
      SELECT 
        cb.*,
        array_agg(DISTINCT rc.id) as related_character_ids
      FROM "CharacterBehavior" cb
      LEFT JOIN "_RelatedCharacters" rc ON cb.id = rc."A"
      WHERE cb."novelId" = ${novelId}
      AND cb."chapterId" = ${chapterId}
      GROUP BY cb.id
      ORDER BY cb.timestamp ASC
    `
  }

  private async getWorldRules(novelId: string): Promise<WorldRule[]> {
    // 获取世界规则设定
    return await prisma.$queryRaw<WorldRule[]>`
      SELECT * FROM "WorldRule"
      WHERE "novelId" = ${novelId}
      ORDER BY priority DESC
    `
  }

  private async getPlotElements(novelId: string, chapterId: string): Promise<PlotElement[]> {
    // 获取情节元素
    return await prisma.$queryRaw<PlotElement[]>`
      SELECT 
        pe.*,
        array_agg(DISTINCT rpe.id) as related_element_ids
      FROM "PlotElement" pe
      LEFT JOIN "_RelatedPlotElements" rpe ON pe.id = rpe."A"
      WHERE pe."novelId" = ${novelId}
      AND pe."chapterId" = ${chapterId}
      GROUP BY pe.id
    `
  }

  private async checkPersonalityConsistency(
    behaviors: CharacterBehavior[],
    config: BehaviorCheckConfig
  ): Promise<ConsistencyIssue[]> {
    if (!config.validatePersonality) return []

    const issues: ConsistencyIssue[] = []
    const characterBehaviors = new Map<string, CharacterBehavior[]>()

    // 按角色分组行为
    for (const behavior of behaviors) {
      if (!characterBehaviors.has(behavior.characterId)) {
        characterBehaviors.set(behavior.characterId, [])
      }
      characterBehaviors.get(behavior.characterId)!.push(behavior)
    }

    // 分析每个角色的行为一致性
    for (const [characterId, charBehaviors] of characterBehaviors) {
      const personalityIssues = await this.analyzePersonalityConsistency(characterId, charBehaviors)
      issues.push(...personalityIssues)
    }

    return issues
  }

  private async analyzePersonalityConsistency(
    characterId: string,
    behaviors: CharacterBehavior[]
  ): Promise<ConsistencyIssue[]> {
    const predictionInput: PredictionInput = {
      type: 'personality_consistency',
      events: behaviors.map((b) => ({
        id: b.id,
        description: b.description,
        type: b.type,
        timestamp: b.timestamp
      })),
      relations: []
    }

    const predictions = await this.mlPredictor.predict(predictionInput)
    return predictions.map((prediction) => ({
      id: uuidv4(),
      type: 'personality_inconsistency',
      description: prediction.details,
      details: prediction.details,
      severity: prediction.severity as 'high' | 'medium' | 'low',
      status: 'open',
      autoFixable: false,
      fixSuggestion: prediction.suggestion,
      metadata: {
        characterId,
        prediction
      },
      createdAt: new Date(),
      updatedAt: new Date()
    }))
  }

  private async checkRelationshipConsistency(
    behaviors: CharacterBehavior[],
    config: BehaviorCheckConfig
  ): Promise<ConsistencyIssue[]> {
    if (!config.validateRelationships) return []

    const issues: ConsistencyIssue[] = []
    const characterInteractions = new Map<string, CharacterBehavior[]>()

    // 收集角色互动
    for (const behavior of behaviors) {
      if (behavior.relatedCharacters) {
        for (const relatedId of behavior.relatedCharacters) {
          const interactionKey = [behavior.characterId, relatedId].sort().join('_')
          if (!characterInteractions.has(interactionKey)) {
            characterInteractions.set(interactionKey, [])
          }
          characterInteractions.get(interactionKey)!.push(behavior)
        }
      }
    }

    // 分析互动一致性
    for (const [interactionKey, interactions] of characterInteractions) {
      const [char1Id, char2Id] = interactionKey.split('_')
      const relationshipIssues = await this.analyzeRelationshipConsistency(char1Id, char2Id, interactions)
      issues.push(...relationshipIssues)
    }

    return issues
  }

  private async analyzeRelationshipConsistency(
    char1Id: string,
    char2Id: string,
    interactions: CharacterBehavior[]
  ): Promise<ConsistencyIssue[]> {
    const predictionInput: PredictionInput = {
      type: 'relationship_consistency',
      events: interactions.map((b) => ({
        id: b.id,
        description: b.description,
        type: b.type,
        timestamp: b.timestamp
      })),
      relations: []
    }

    const predictions = await this.mlPredictor.predict(predictionInput)
    return predictions.map((prediction) => ({
      id: uuidv4(),
      type: 'relationship_inconsistency',
      description: prediction.details,
      details: prediction.details,
      severity: prediction.severity as 'high' | 'medium' | 'low',
      status: 'open',
      autoFixable: false,
      fixSuggestion: prediction.suggestion,
      metadata: {
        characters: [char1Id, char2Id],
        prediction
      },
      createdAt: new Date(),
      updatedAt: new Date()
    }))
  }

  private async checkMotivationConsistency(
    behaviors: CharacterBehavior[],
    config: BehaviorCheckConfig
  ): Promise<ConsistencyIssue[]> {
    if (!config.validateMotivations) return []

    const issues: ConsistencyIssue[] = []
    const characterBehaviors = new Map<string, CharacterBehavior[]>()

    // 按角色分组行为
    for (const behavior of behaviors) {
      if (!characterBehaviors.has(behavior.characterId)) {
        characterBehaviors.set(behavior.characterId, [])
      }
      characterBehaviors.get(behavior.characterId)!.push(behavior)
    }

    // 分析每个角色的动机一致性
    for (const [characterId, charBehaviors] of characterBehaviors) {
      const motivationIssues = await this.analyzeMotivationConsistency(characterId, charBehaviors)
      issues.push(...motivationIssues)
    }

    return issues
  }

  private async analyzeMotivationConsistency(
    characterId: string,
    behaviors: CharacterBehavior[]
  ): Promise<ConsistencyIssue[]> {
    const predictionInput: PredictionInput = {
      type: 'motivation_consistency',
      events: behaviors.map((b) => ({
        id: b.id,
        description: b.description,
        type: b.type,
        timestamp: b.timestamp
      })),
      relations: []
    }

    const predictions = await this.mlPredictor.predict(predictionInput)
    return predictions.map((prediction) => ({
      id: uuidv4(),
      type: 'motivation_inconsistency',
      description: prediction.details,
      details: prediction.details,
      severity: prediction.severity as 'high' | 'medium' | 'low',
      status: 'open',
      autoFixable: false,
      fixSuggestion: prediction.suggestion,
      metadata: {
        characterId,
        prediction
      },
      createdAt: new Date(),
      updatedAt: new Date()
    }))
  }

  private async checkCharacterGrowth(
    behaviors: CharacterBehavior[],
    config: BehaviorCheckConfig
  ): Promise<ConsistencyIssue[]> {
    if (!config.validateGrowth) return []

    const issues: ConsistencyIssue[] = []
    const characterBehaviors = new Map<string, CharacterBehavior[]>()

    // 按角色分组行为
    for (const behavior of behaviors) {
      if (!characterBehaviors.has(behavior.characterId)) {
        characterBehaviors.set(behavior.characterId, [])
      }
      characterBehaviors.get(behavior.characterId)!.push(behavior)
    }

    // 分析每个角色的成长轨迹
    for (const [characterId, charBehaviors] of characterBehaviors) {
      const growthIssues = await this.analyzeCharacterGrowth(characterId, charBehaviors)
      issues.push(...growthIssues)
    }

    return issues
  }

  private async analyzeCharacterGrowth(
    characterId: string,
    behaviors: CharacterBehavior[]
  ): Promise<ConsistencyIssue[]> {
    const predictionInput: PredictionInput = {
      type: 'character_growth',
      events: behaviors.map((b) => ({
        id: b.id,
        description: b.description,
        type: b.type,
        timestamp: b.timestamp
      })),
      relations: []
    }

    const predictions = await this.mlPredictor.predict(predictionInput)
    return predictions.map((prediction) => ({
      id: uuidv4(),
      type: 'character_growth_issue',
      description: prediction.details,
      details: prediction.details,
      severity: prediction.severity as 'high' | 'medium' | 'low',
      status: 'open',
      autoFixable: false,
      fixSuggestion: prediction.suggestion,
      metadata: {
        characterId,
        prediction
      },
      createdAt: new Date(),
      updatedAt: new Date()
    }))
  }

  private async checkWorldRuleCompliance(
    behaviors: CharacterBehavior[],
    worldRules: WorldRule[],
    config: BehaviorCheckConfig
  ): Promise<ConsistencyIssue[]> {
    if (!config.validateWorldRules) return []

    const issues: ConsistencyIssue[] = []

    // 检查每个行为是否符合世界规则
    for (const behavior of behaviors) {
      for (const rule of worldRules) {
        const ruleIssues = await this.checkBehaviorAgainstRule(behavior, rule)
        issues.push(...ruleIssues)
      }
    }

    return issues
  }

  private async checkBehaviorAgainstRule(behavior: CharacterBehavior, rule: WorldRule): Promise<ConsistencyIssue[]> {
    const predictionInput: PredictionInput = {
      type: 'world_rule_compliance',
      events: [
        {
          id: behavior.id,
          description: behavior.description,
          type: behavior.type,
          timestamp: behavior.timestamp
        }
      ],
      relations: [],
      metadata: {
        rule: {
          category: rule.category,
          name: rule.name,
          description: rule.description,
          constraints: rule.constraints
        }
      }
    }

    const predictions = await this.mlPredictor.predict(predictionInput)
    return predictions.map((prediction) => ({
      id: uuidv4(),
      type: 'world_rule_violation',
      description: prediction.details,
      details: prediction.details,
      severity: prediction.severity as 'high' | 'medium' | 'low',
      status: 'open',
      autoFixable: false,
      fixSuggestion: prediction.suggestion,
      metadata: {
        behaviorId: behavior.id,
        ruleId: rule.id,
        prediction
      },
      createdAt: new Date(),
      updatedAt: new Date()
    }))
  }

  private async checkPlotLogic(
    behaviors: CharacterBehavior[],
    plotElements: PlotElement[],
    config: BehaviorCheckConfig
  ): Promise<ConsistencyIssue[]> {
    if (!config.validatePlotLogic) return []

    const issues: ConsistencyIssue[] = []

    // 检查行为与情节的逻辑关系
    for (const behavior of behaviors) {
      const plotIssues = await this.analyzePlotLogic(behavior, plotElements)
      issues.push(...plotIssues)
    }

    return issues
  }

  private async analyzePlotLogic(
    behavior: CharacterBehavior,
    plotElements: PlotElement[]
  ): Promise<ConsistencyIssue[]> {
    const predictionInput: PredictionInput = {
      type: 'plot_logic',
      events: [
        {
          id: behavior.id,
          description: behavior.description,
          type: behavior.type,
          timestamp: behavior.timestamp
        }
      ],
      relations: [],
      metadata: {
        plotElements: plotElements.map((pe) => ({
          id: pe.id,
          type: pe.type,
          description: pe.description,
          importance: pe.importance,
          status: pe.status
        }))
      }
    }

    const predictions = await this.mlPredictor.predict(predictionInput)
    return predictions.map((prediction) => ({
      id: uuidv4(),
      type: 'plot_logic_issue',
      description: prediction.details,
      details: prediction.details,
      severity: prediction.severity as 'high' | 'medium' | 'low',
      status: 'open',
      autoFixable: false,
      fixSuggestion: prediction.suggestion,
      metadata: {
        behaviorId: behavior.id,
        plotElements: plotElements.map((pe) => pe.id),
        prediction
      },
      createdAt: new Date(),
      updatedAt: new Date()
    }))
  }

  private async analyzePotentialIssues(
    behaviors: CharacterBehavior[],
    worldRules: WorldRule[],
    plotElements: PlotElement[]
  ): Promise<ConsistencyIssue[]> {
    const predictionInput: PredictionInput = {
      type: 'behavior_consistency',
      events: behaviors.map((b) => ({
        id: b.id,
        description: b.description,
        type: b.type,
        timestamp: b.timestamp
      })),
      relations: []
    }

    const predictions = await this.mlPredictor.predict(predictionInput)
    return predictions.map((prediction) => ({
      id: uuidv4(),
      type: 'potential_behavior_issue',
      description: prediction.details,
      details: prediction.details,
      severity: prediction.severity as 'high' | 'medium' | 'low',
      status: 'open',
      autoFixable: false,
      fixSuggestion: prediction.suggestion,
      metadata: {
        prediction
      },
      createdAt: new Date(),
      updatedAt: new Date()
    }))
  }

  private async createConsistencyIssue(input: ConsistencyIssueInput): Promise<ConsistencyIssue> {
    const now = new Date()
    return {
      id: uuidv4(),
      description: input.details,
      status: 'open',
      createdAt: now,
      updatedAt: now,
      ...input
    }
  }
}

// 导出单例实例
export const behaviorConsistencyChecker = BehaviorConsistencyChecker.getInstance(
  ErrorAnalyzer.getInstance(),
  mlPredictor
)
