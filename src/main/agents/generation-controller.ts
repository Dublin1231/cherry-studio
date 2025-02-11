import { EventEmitter } from 'events'

import { errorHandler } from '../db/error-handler'

export interface GenerationState {
  id: string
  status: 'running' | 'paused' | 'completed' | 'error'
  progress: number
  content: string
  context?: any
  error?: string
  timestamp: number
}

export class GenerationController extends EventEmitter {
  private static instance: GenerationController
  private activeGenerations: Map<string, GenerationState> = new Map()
  private pausedGenerations: Map<string, GenerationState> = new Map()

  private constructor() {
    super()
  }

  static getInstance(): GenerationController {
    if (!GenerationController.instance) {
      GenerationController.instance = new GenerationController()
    }
    return GenerationController.instance
  }

  // 开始新的生成任务
  startGeneration(id: string, context?: any): void {
    const state: GenerationState = {
      id,
      status: 'running',
      progress: 0,
      content: '',
      context,
      timestamp: Date.now()
    }

    this.activeGenerations.set(id, state)
    this.emit('generation:start', state)
  }

  // 暂停生成任务
  pauseGeneration(id: string): boolean {
    const state = this.activeGenerations.get(id)
    if (!state || state.status !== 'running') {
      return false
    }

    state.status = 'paused'
    this.pausedGenerations.set(id, state)
    this.activeGenerations.delete(id)
    this.emit('generation:pause', state)
    return true
  }

  // 继续生成任务
  resumeGeneration(id: string): boolean {
    const state = this.pausedGenerations.get(id)
    if (!state || state.status !== 'paused') {
      return false
    }

    state.status = 'running'
    this.activeGenerations.set(id, state)
    this.pausedGenerations.delete(id)
    this.emit('generation:resume', state)
    return true
  }

  // 更新生成进度
  updateProgress(id: string, progress: number, content: string): void {
    const state = this.activeGenerations.get(id)
    if (!state) {
      return
    }

    state.progress = progress
    state.content = content
    this.emit('generation:progress', state)
  }

  // 完成生成任务
  completeGeneration(id: string, finalContent: string): void {
    const state = this.activeGenerations.get(id)
    if (!state) {
      return
    }

    state.status = 'completed'
    state.progress = 100
    state.content = finalContent
    this.activeGenerations.delete(id)
    this.emit('generation:complete', state)
  }

  // 处理生成错误
  handleGenerationError(id: string, error: Error): void {
    const state = this.activeGenerations.get(id)
    if (!state) {
      return
    }

    state.status = 'error'
    state.error = error.message
    this.activeGenerations.delete(id)
    this.emit('generation:error', state)
    errorHandler.handleError(error, { context: 'generation', generationId: id })
  }

  // 获取生成状态
  getGenerationState(id: string): GenerationState | undefined {
    return this.activeGenerations.get(id) || this.pausedGenerations.get(id)
  }

  // 获取所有活跃的生成任务
  getActiveGenerations(): GenerationState[] {
    return Array.from(this.activeGenerations.values())
  }

  // 获取所有暂停的生成任务
  getPausedGenerations(): GenerationState[] {
    return Array.from(this.pausedGenerations.values())
  }

  // 清理完成或错误的生成任务
  private cleanupCompletedGenerations() {
    const now = Date.now()
    const CLEANUP_THRESHOLD = 24 * 60 * 60 * 1000 // 24小时

    for (const [id, state] of this.activeGenerations) {
      if (state.status === 'completed' || state.status === 'error') {
        if (now - state.timestamp > CLEANUP_THRESHOLD) {
          this.activeGenerations.delete(id)
        }
      }
    }
  }
}

export const generationController = GenerationController.getInstance()
