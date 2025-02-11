import { styleConsistencyManager } from '../agents/style-consistency-manager'
import { errorHandler } from './error-handler'
import { PerformanceMonitor } from './performance-monitor'
import { prisma } from './prisma'

interface ConsistencyIssue {
  type: string
  details: string
  severity: 'low' | 'medium' | 'high'
  autoFixable: boolean
  fixSuggestion?: string
  fixStrategy?: string
  relatedIssues?: string[]
  metadata?: Record<string, any>
}

interface FixAttempt {
  type: string
  success: boolean
  error?: string
  strategy: string
  fixedContent?: string
}

interface ConsistencyCheckResult {
  isConsistent: boolean
  inconsistencies: ConsistencyIssue[]
  timestamp: Date
  duration: number
  fixAttempts?: FixAttempt[]
}

interface ConsistencyCheckConfig {
  checkInterval: number
  batchSize: number
  parallelChecks: number
  autoFix: boolean
  maxFixAttempts: number
  fixStrategies: {
    [key: string]: {
      enabled: boolean
      priority: number
      maxRetries: number
    }
  }
  checkStyleConsistency: boolean
}

export class ConsistencyChecker {
  private static instance: ConsistencyChecker
  private config: ConsistencyCheckConfig
  private lastCheckResult?: ConsistencyCheckResult
  private checkInProgress: boolean = false

  private constructor(config: Partial<ConsistencyCheckConfig> = {}) {
    this.config = {
      checkInterval: config.checkInterval || 6 * 60 * 60 * 1000,
      batchSize: config.batchSize || 1000,
      parallelChecks: config.parallelChecks || 4,
      autoFix: config.autoFix || false,
      maxFixAttempts: config.maxFixAttempts || 3,
      fixStrategies: config.fixStrategies || {},
      checkStyleConsistency: config.checkStyleConsistency || true
    }

    setInterval(() => this.runConsistencyCheck(), this.config.checkInterval)
  }

  static getInstance(config?: Partial<ConsistencyCheckConfig>): ConsistencyChecker {
    if (!ConsistencyChecker.instance) {
      ConsistencyChecker.instance = new ConsistencyChecker(config)
    }
    return ConsistencyChecker.instance
  }

  async runConsistencyCheck(): Promise<ConsistencyCheckResult> {
    if (this.checkInProgress) {
      throw new Error('一致性检查正在进行中')
    }

    this.checkInProgress = true
    const startTime = Date.now()
    const inconsistencies: ConsistencyIssue[] = []
    const fixAttempts: FixAttempt[] = []

    try {
      const endMetrics = PerformanceMonitor.getInstance().startOperation('consistencyCheck')

      // 执行多层次的一致性检查，包括基础检查、高级检查和性能检查
      const check = errorHandler.withRetry('consistencyCheck', async () => {
        // 1. 执行基础一致性检查
        const basicInconsistencies = await this.checkBasicConsistency()
        inconsistencies.push(...basicInconsistencies)

        // 2. 执行高级一致性检查
        const advancedInconsistencies = await this.checkAdvancedConsistency()
        inconsistencies.push(...advancedInconsistencies)

        // 3. 检查性能问题
        const performanceInconsistencies = await this.checkPerformanceIssues()
        inconsistencies.push(...performanceInconsistencies)

        // 4. 检查数据质量问题
        const qualityInconsistencies = await this.checkDataQuality()
        inconsistencies.push(...qualityInconsistencies)

        // 5. 检查文风一致性
        if (this.config.checkStyleConsistency) {
          const styleIssues = await this.checkStyleConsistency(content)
          inconsistencies.push(...styleIssues)
        }

        // 如果配置了自动修复，尝试修复可以自动修复的问题
        if (this.config.autoFix) {
          for (const issue of inconsistencies) {
            if (issue.autoFixable) {
              const fixResult = await this.attemptAutoFix(issue, content)
              fixAttempts.push(fixResult)
            }
          }
        }
      })

      await check()
      endMetrics()

      const result: ConsistencyCheckResult = {
        isConsistent: inconsistencies.length === 0,
        inconsistencies,
        timestamp: new Date(),
        duration: Date.now() - startTime,
        fixAttempts: fixAttempts.length > 0 ? fixAttempts : undefined
      }

      this.lastCheckResult = result
      return result
    } finally {
      this.checkInProgress = false
    }
  }

  private async checkBasicConsistency(): Promise<ConsistencyIssue[]> {
    const inconsistencies: ConsistencyIssue[] = []

    // 检查孤立的记忆锚点
    const orphanedMemories = await prisma.memoryAnchor.findMany({
      where: {
        chapterId: {
          equals: undefined
        }
      }
    })

    if (orphanedMemories.length > 0) {
      inconsistencies.push({
        type: 'orphaned_memories',
        details: `发现 ${orphanedMemories.length} 个孤立的记忆锚点`,
        severity: 'high',
        autoFixable: true,
        fixSuggestion: '删除或重新关联这些孤立的记忆锚点'
      })
    }

    // 检查重复的章节
    const duplicateChapters = await prisma.$queryRaw`
      SELECT novelId, number, COUNT(*) as count
      FROM Chapter
      GROUP BY novelId, number
      HAVING count > 1
    `

    if (Array.isArray(duplicateChapters) && duplicateChapters.length > 0) {
      inconsistencies.push({
        type: 'duplicate_chapters',
        details: `发现 ${duplicateChapters.length} 个重复的章节`,
        severity: 'high',
        autoFixable: true,
        fixSuggestion: '合并或删除重复的章节'
      })
    }

    return inconsistencies
  }

  private async checkAdvancedConsistency(): Promise<ConsistencyIssue[]> {
    const inconsistencies: ConsistencyIssue[] = []

    // 优化：使用原生SQL查询检查时序关系的一致性
    const invalidTemporalRelations = await prisma.$queryRaw`
      SELECT 
        ma1.id as source_id,
        c1.number as source_chapter,
        ma2.id as target_id,
        c2.number as target_chapter
      FROM "MemoryAnchor" ma1
      JOIN "MemoryRelation" mr ON ma1.id = mr."sourceId"
      JOIN "MemoryAnchor" ma2 ON ma2.id = mr."targetId"
      JOIN "Chapter" c1 ON ma1."chapterId" = c1.id
      JOIN "Chapter" c2 ON ma2."chapterId" = c2.id
      WHERE mr.type = 'temporal'
      AND c1.number >= c2.number
    `

    if (Array.isArray(invalidTemporalRelations) && invalidTemporalRelations.length > 0) {
      for (const relation of invalidTemporalRelations) {
        inconsistencies.push({
          type: 'invalid_temporal_relation',
          details: `时序关系错误：章节 ${relation.source_chapter} 不应晚于章节 ${relation.target_chapter}`,
          severity: 'medium',
          autoFixable: true,
          fixSuggestion: '调整记忆锚点的时序关系或修正章节顺序',
          metadata: {
            sourceId: relation.source_id,
            targetId: relation.target_id
          }
        })
      }
    }

    return inconsistencies
  }

  private async checkPerformanceIssues(): Promise<ConsistencyIssue[]> {
    const inconsistencies: ConsistencyIssue[] = []

    // 检查过大的章节
    const largeChapters = await prisma.chapter.findMany({
      where: {
        content: {
          gt: '10000' // 超过10000字符的章节
        }
      }
    })

    if (largeChapters.length > 0) {
      inconsistencies.push({
        type: 'large_chapters',
        details: `发现 ${largeChapters.length} 个内容过长的章节可能影响性能`,
        severity: 'medium',
        autoFixable: false,
        fixSuggestion: '考虑将大章节拆分为多个较小的章节'
      })
    }

    // 检查记忆锚点过多的章节
    const chaptersWithManyAnchors = (
      await prisma.chapter.findMany({
        include: {
          memories: true,
          _count: {
            select: {
              memories: true
            }
          }
        },
        where: {
          memories: {
            some: {}
          }
        }
      })
    ).filter((chapter) => chapter._count.memories > 100)

    if (chaptersWithManyAnchors.length > 0) {
      inconsistencies.push({
        type: 'too_many_anchors',
        details: `发现 ${chaptersWithManyAnchors.length} 个记忆锚点过多的章节`,
        severity: 'medium',
        autoFixable: false,
        fixSuggestion: '检查并优化记忆锚点的数量'
      })
    }

    return inconsistencies
  }

  private async checkDataQuality(): Promise<ConsistencyIssue[]> {
    const inconsistencies: ConsistencyIssue[] = []

    // 优化：使用原生SQL查询检查空章节
    const emptyChapters = await prisma.$queryRaw`
      SELECT id, title, "novelId"
      FROM "Chapter"
      WHERE content = '' OR content IS NULL
    `

    if (Array.isArray(emptyChapters) && emptyChapters.length > 0) {
      inconsistencies.push({
        type: 'empty_chapters',
        details: `发现 ${emptyChapters.length} 个空章节`,
        severity: 'medium',
        autoFixable: true,
        fixSuggestion: '删除或填充空章节'
      })
    }

    // 优化：使用原生SQL查询检查低质量的记忆锚点
    const lowQualityMemories = await prisma.$queryRaw`
      SELECT id, content, weight
      FROM "MemoryAnchor"
      WHERE content LIKE '%待完善%'
      OR content LIKE '%TODO%'
      OR weight < 0.3
    `

    if (Array.isArray(lowQualityMemories) && lowQualityMemories.length > 0) {
      inconsistencies.push({
        type: 'low_quality_memories',
        details: `发现 ${lowQualityMemories.length} 个质量较低的记忆锚点`,
        severity: 'low',
        autoFixable: false,
        fixSuggestion: '审查并改进质量较低的记忆锚点',
        metadata: {
          memoryIds: lowQualityMemories.map((m) => m.id)
        }
      })
    }

    return inconsistencies
  }

  private async checkStyleConsistency(novelContent: string): Promise<ConsistencyIssue[]> {
    const issues: ConsistencyIssue[] = []

    try {
      const analysis = await styleConsistencyManager.analyzeStyle(novelContent)

      if (analysis.matchScore < 0.8) {
        for (const deviation of analysis.deviations) {
          issues.push({
            type: 'style_inconsistency',
            details: `文风不一致: ${deviation.aspect} 期望 ${deviation.expected}, 实际 ${deviation.actual}`,
            severity: deviation.severity,
            autoFixable: true,
            fixSuggestion: analysis.suggestions.join('\n'),
            fixStrategy: 'style_adjustment',
            metadata: {
              aspect: deviation.aspect,
              expected: deviation.expected,
              actual: deviation.actual,
              matchScore: analysis.matchScore
            }
          })
        }
      }
    } catch (error) {
      console.error('文风一致性检查失败:', error)
    }

    return issues
  }

  private async fixStyleInconsistency(novelContent: string, issue: ConsistencyIssue): Promise<string> {
    try {
      return await styleConsistencyManager.adjustStyle(novelContent, issue.metadata)
    } catch (error) {
      console.error('文风调整失败:', error)
      return novelContent
    }
  }

  private async attemptAutoFix(issue: ConsistencyIssue, content: string): Promise<FixAttempt> {
    try {
      switch (issue.type) {
        case 'empty_chapter': {
          await this.fixEmptyChapters()
          return {
            type: issue.type,
            success: true,
            strategy: 'auto_generate'
          }
        }
        case 'style_inconsistency': {
          const result = await this.fixStyleInconsistency(content, issue)
          return {
            type: 'style_fix',
            success: result !== content,
            strategy: 'style_adjustment',
            fixedContent: result
          }
        }
        default:
          throw new Error(`不支持的自动修复类型: ${issue.type}`)
      }
    } catch (error) {
      const err = error as Error
      return {
        type: issue.type,
        success: false,
        strategy: 'failed',
        error: err.message
      }
    }
  }

  private determineFixStrategy(issue: ConsistencyIssue): string {
    // 根据问题类型和配置确定最佳的修复策略
    const strategyMap = {
      orphaned_memories: 'delete',
      duplicate_chapters: 'merge',
      invalid_temporal_relation: 'reorder',
      empty_chapters: 'remove'
    }

    const defaultStrategy = strategyMap[issue.type as keyof typeof strategyMap]
    if (!defaultStrategy) {
      throw new Error(`未找到对应的修复策略: ${issue.type}`)
    }

    return defaultStrategy
  }

  private async fixOrphanedMemories(): Promise<void> {
    // 优化：使用批量删除
    await prisma.$executeRaw`
      DELETE FROM "MemoryAnchor"
      WHERE "chapterId" IS NULL
    `
  }

  private async fixDuplicateChapters(): Promise<void> {
    // 优化：使用事务和批量操作
    await prisma.$transaction(async (tx) => {
      // 1. 找出所有重复的章节
      const duplicates = await tx.$queryRaw`
        WITH duplicates AS (
          SELECT "novelId", number, MIN(id) as keep_id
          FROM "Chapter"
          GROUP BY "novelId", number
          HAVING COUNT(*) > 1
        )
        SELECT c.id, c."novelId", c.number, d.keep_id
        FROM "Chapter" c
        JOIN duplicates d ON c."novelId" = d."novelId" AND c.number = d.number
        WHERE c.id != d.keep_id
      `

      if (!Array.isArray(duplicates) || duplicates.length === 0) {
        return
      }

      // 2. 更新关联的记忆锚点到保留的章节
      for (const dup of duplicates) {
        await tx.$executeRaw`
          UPDATE "MemoryAnchor"
          SET "chapterId" = ${dup.keep_id}
          WHERE "chapterId" = ${dup.id}
        `
      }

      // 3. 删除重复的章节
      const duplicateIds = duplicates.map((d) => d.id)
      await tx.$executeRaw`
        DELETE FROM "Chapter"
        WHERE id = ANY(${duplicateIds}::uuid[])
      `
    })
  }

  private async fixTemporalRelations(): Promise<void> {
    // 修复时序关系错误
    await prisma.memoryRelation.deleteMany({
      where: {
        type: 'temporal',
        AND: [
          {
            source: {
              chapter: {
                number: {
                  gte: 0
                }
              }
            }
          },
          {
            target: {
              chapter: {
                number: {
                  gte: 0
                }
              }
            }
          }
        ]
      }
    })
  }

  private async fixEmptyChapters(): Promise<void> {
    await prisma.chapter.deleteMany({
      where: {
        content: {
          equals: ''
        }
      }
    })
  }

  private async fixVectorInconsistency(): Promise<void> {
    const memoryAnchors = await prisma.memoryAnchor.findMany({
      where: {
        embedding: {
          equals: undefined
        }
      }
    })

    for (const anchor of memoryAnchors) {
      try {
        const embedding = await this.generateEmbedding()
        await prisma.memoryAnchor.update({
          where: { id: anchor.id },
          data: { embedding }
        })
      } catch (error) {
        console.error(`生成向量嵌入失败: ${anchor.id}`, error)
      }
    }
  }

  private async fixRelationshipCycles(): Promise<void> {
    const relations = await prisma.memoryRelation.findMany({
      include: {
        source: true,
        target: true
      }
    })

    const cycles = this.detectCycles(relations)
    for (const cycle of cycles) {
      await prisma.memoryRelation.delete({
        where: { id: cycle[0] }
      })
    }
  }

  private async fixMemoryWeightAnomaly(): Promise<void> {
    const anomalies = await prisma.memoryAnchor.findMany({
      where: {
        OR: [{ weight: { lt: 0 } }, { weight: { gt: 1 } }]
      }
    })

    for (const anchor of anomalies) {
      await prisma.memoryAnchor.update({
        where: { id: anchor.id },
        data: { weight: Math.max(0, Math.min(1, anchor.weight)) }
      })
    }
  }

  private async fixChapterSequenceGap(): Promise<void> {
    const novels = await prisma.novel.findMany({
      include: {
        chapters: {
          orderBy: { number: 'asc' }
        }
      }
    })

    for (const novel of novels) {
      let expectedNumber = 1
      for (const chapter of novel.chapters) {
        if (chapter.number !== expectedNumber) {
          await prisma.chapter.update({
            where: { id: chapter.id },
            data: { number: expectedNumber }
          })
        }
        expectedNumber++
      }
    }
  }

  private async fixDanglingReferences(): Promise<void> {
    await prisma.memoryRelation.deleteMany({
      where: {
        OR: [
          {
            sourceId: {
              equals: undefined
            }
          },
          {
            targetId: {
              equals: undefined
            }
          }
        ]
      }
    })
  }

  private async fixDataRedundancy(): Promise<void> {
    // 查找并处理重复的记忆锚点
    const duplicates = await prisma.$queryRaw`
      SELECT content, COUNT(*) as count
      FROM MemoryAnchor
      GROUP BY content
      HAVING count > 1
    `

    for (const dup of duplicates as any[]) {
      const anchors = await prisma.memoryAnchor.findMany({
        where: { content: dup.content },
        include: { relations: true }
      })

      // 保留第一个，合并其他的关系到第一个
      const [keep, ...remove] = anchors
      for (const anchor of remove) {
        // 更新关系
        await prisma.memoryRelation.updateMany({
          where: { sourceId: anchor.id },
          data: { sourceId: keep.id }
        })
        await prisma.memoryRelation.updateMany({
          where: { targetId: anchor.id },
          data: { targetId: keep.id }
        })
        // 删除重复的锚点
        await prisma.memoryAnchor.delete({
          where: { id: anchor.id }
        })
      }
    }
  }

  private detectCycles(relations: any[]): string[][] {
    const graph = new Map<string, string[]>()
    for (const rel of relations) {
      if (!graph.has(rel.sourceId)) {
        graph.set(rel.sourceId, [])
      }
      graph.get(rel.sourceId)!.push(rel.targetId)
    }

    const cycles: string[][] = []
    const visited = new Set<string>()
    const path = new Set<string>()

    function dfs(node: string, path: Set<string>, cycle: string[]) {
      if (path.has(node)) {
        cycles.push([...cycle])
        return
      }
      if (visited.has(node)) return

      visited.add(node)
      path.add(node)

      for (const neighbor of graph.get(node) || []) {
        dfs(neighbor, path, [...cycle, neighbor])
      }

      path.delete(node)
    }

    for (const node of graph.keys()) {
      if (!visited.has(node)) {
        dfs(node, path, [node])
      }
    }

    return cycles
  }

  private async generateEmbedding(): Promise<Buffer> {
    // TODO: 实现向量嵌入生成逻辑
    throw new Error('尚未实现向量嵌入生成功能')
  }
}

export const consistencyChecker = ConsistencyChecker.getInstance()
