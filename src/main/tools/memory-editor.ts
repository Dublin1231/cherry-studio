import { EventEmitter } from 'events'
import { MemoryAnchor } from '../db/types'

interface EditOperation {
  type: 'create' | 'update' | 'delete'
  anchor: MemoryAnchor
  timestamp: Date
  userId: string
}

interface EditHistory {
  operations: EditOperation[]
  undoStack: EditOperation[]
  redoStack: EditOperation[]
}

interface EditorConfig {
  maxHistorySize: number
  autoSave: boolean
  saveInterval: number
  validateOnEdit: boolean
}

export class MemoryEditor extends EventEmitter {
  private static instance: MemoryEditor
  private config: EditorConfig
  private history: EditHistory
  private activeAnchor: MemoryAnchor | null = null
  private saveTimer: NodeJS.Timeout | null = null

  private constructor() {
    super()
    this.config = {
      maxHistorySize: 100,
      autoSave: true,
      saveInterval: 5 * 60 * 1000, // 5分钟
      validateOnEdit: true
    }
    this.history = {
      operations: [],
      undoStack: [],
      redoStack: []
    }
  }

  static getInstance(): MemoryEditor {
    if (!MemoryEditor.instance) {
      MemoryEditor.instance = new MemoryEditor()
    }
    return MemoryEditor.instance
  }

  // 创建新的记忆锚点
  async createAnchor(anchor: Omit<MemoryAnchor, 'id'>): Promise<MemoryAnchor> {
    const newAnchor: MemoryAnchor = {
      ...anchor,
      id: this.generateId()
    }

    if (this.config.validateOnEdit) {
      this.validateAnchor(newAnchor)
    }

    const operation: EditOperation = {
      type: 'create',
      anchor: newAnchor,
      timestamp: new Date(),
      userId: 'system' // TODO: 集成用户系统
    }

    this.recordOperation(operation)
    this.emit('anchor_created', newAnchor)
    
    if (this.config.autoSave) {
      this.scheduleSave()
    }

    return newAnchor
  }

  // 更新记忆锚点
  async updateAnchor(id: string, updates: Partial<MemoryAnchor>): Promise<MemoryAnchor> {
    const currentAnchor = this.findAnchor(id)
    if (!currentAnchor) {
      throw new Error(`记忆锚点不存在: ${id}`)
    }

    const updatedAnchor: MemoryAnchor = {
      ...currentAnchor,
      ...updates
    }

    if (this.config.validateOnEdit) {
      this.validateAnchor(updatedAnchor)
    }

    const operation: EditOperation = {
      type: 'update',
      anchor: updatedAnchor,
      timestamp: new Date(),
      userId: 'system'
    }

    this.recordOperation(operation)
    this.emit('anchor_updated', updatedAnchor)

    if (this.config.autoSave) {
      this.scheduleSave()
    }

    return updatedAnchor
  }

  // 删除记忆锚点
  async deleteAnchor(id: string): Promise<void> {
    const anchor = this.findAnchor(id)
    if (!anchor) {
      throw new Error(`记忆锚点不存在: ${id}`)
    }

    const operation: EditOperation = {
      type: 'delete',
      anchor,
      timestamp: new Date(),
      userId: 'system'
    }

    this.recordOperation(operation)
    this.emit('anchor_deleted', anchor)

    if (this.config.autoSave) {
      this.scheduleSave()
    }
  }

  // 撤销操作
  undo(): void {
    const operation = this.history.undoStack.pop()
    if (!operation) return

    this.revertOperation(operation)
    this.history.redoStack.push(operation)
    this.emit('operation_undone', operation)
  }

  // 重做操作
  redo(): void {
    const operation = this.history.redoStack.pop()
    if (!operation) return

    this.applyOperation(operation)
    this.history.undoStack.push(operation)
    this.emit('operation_redone', operation)
  }

  // 设置活动锚点
  setActiveAnchor(anchor: MemoryAnchor | null): void {
    this.activeAnchor = anchor
    this.emit('active_anchor_changed', anchor)
  }

  // 获取编辑历史
  getHistory(): EditHistory {
    return this.history
  }

  // 清除历史记录
  clearHistory(): void {
    this.history = {
      operations: [],
      undoStack: [],
      redoStack: []
    }
    this.emit('history_cleared')
  }

  // 验证记忆锚点
  private validateAnchor(anchor: MemoryAnchor): void {
    if (!anchor.content || anchor.content.trim().length === 0) {
      throw new Error('记忆锚点内容不能为空')
    }

    if (!anchor.type) {
      throw new Error('记忆锚点类型不能为空')
    }

    if (!anchor.chapterId) {
      throw new Error('必须指定章节ID')
    }
  }

  // 记录操作
  private recordOperation(operation: EditOperation): void {
    this.history.operations.push(operation)
    this.history.undoStack.push(operation)
    this.history.redoStack = []

    if (this.history.operations.length > this.config.maxHistorySize) {
      this.history.operations.shift()
    }
  }

  // 应用操作
  private applyOperation(operation: EditOperation): void {
    switch (operation.type) {
      case 'create':
        // 实现创建逻辑
        break
      case 'update':
        // 实现更新逻辑
        break
      case 'delete':
        // 实现删除逻辑
        break
    }
  }

  // 撤销操作
  private revertOperation(operation: EditOperation): void {
    switch (operation.type) {
      case 'create':
        // 撤销创建
        break
      case 'update':
        // 撤销更新
        break
      case 'delete':
        // 撤销删除
        break
    }
  }

  // 查找记忆锚点
  private findAnchor(id: string): MemoryAnchor | null {
    // TODO: 实现查找逻辑
    return null
  }

  // 生成唯一ID
  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2)
  }

  // 调度自动保存
  private scheduleSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
    }

    this.saveTimer = setTimeout(() => {
      this.save()
    }, this.config.saveInterval)
  }

  // 保存更改
  private async save(): Promise<void> {
    // TODO: 实现持久化逻辑
    this.emit('changes_saved')
  }

  // 更新配置
  setConfig(config: Partial<EditorConfig>): void {
    this.config = { ...this.config, ...config }
    this.emit('config_updated', this.config)
  }

  // 获取当前配置
  getConfig(): EditorConfig {
    return this.config
  }
}

// 导出单例实例
export const memoryEditor = MemoryEditor.getInstance() 