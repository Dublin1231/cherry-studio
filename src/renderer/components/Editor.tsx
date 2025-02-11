import {
  BoldOutlined,
  BulbOutlined,
  ItalicOutlined,
  OrderedListOutlined,
  RedoOutlined,
  RollbackOutlined,
  TagOutlined,
  UnderlineOutlined,
  UnorderedListOutlined
} from '@ant-design/icons'
import { Editor as TinyMCEEditor } from '@tinymce/tinymce-react'
import { Button, message, Tooltip } from 'antd'
import debounce from 'lodash/debounce'
import { useEffect, useRef, useState } from 'react'

import styles from './Editor.module.less'

interface EditorProps {
  content: string
  onChange: (content: string) => void
  readOnly?: boolean
  onAddMemoryAnchor?: (text: string, range: any) => void
  onAddForeshadowing?: (text: string, range: any) => void
}

export default function Editor({
  content,
  onChange,
  readOnly = false,
  onAddMemoryAnchor,
  onAddForeshadowing
}: EditorProps) {
  const editorRef = useRef<any>(null)
  const [selectedText, setSelectedText] = useState('')

  // 初始化编辑器配置
  const initConfig = {
    height: '100%',
    menubar: false,
    plugins: [
      'advlist',
      'autolink',
      'lists',
      'link',
      'image',
      'charmap',
      'preview',
      'anchor',
      'searchreplace',
      'visualblocks',
      'code',
      'fullscreen',
      'insertdatetime',
      'media',
      'table',
      'help',
      'wordcount'
    ],
    toolbar: false,
    content_style: `
      body { 
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial;
        font-size: 16px;
        line-height: 1.8;
        padding: 16px;
      }
      .memory-anchor {
        background: rgba(24, 144, 255, 0.1);
        border-bottom: 1px dashed #1890ff;
      }
      .foreshadowing {
        background: rgba(250, 173, 20, 0.1);
        border-bottom: 1px dashed #faad14;
      }
    `,
    readonly: readOnly
  }

  // 处理内容变化
  const handleEditorChange = debounce((content: string) => {
    onChange(content)
  }, 500)

  // 处理选中文本变化
  const handleSelectionChange = () => {
    if (!editorRef.current) return

    const editor = editorRef.current.editor
    const selection = editor.selection.getContent()
    setSelectedText(selection)
  }

  // 添加记忆锚点
  const handleAddMemoryAnchor = () => {
    if (!selectedText || !onAddMemoryAnchor) return

    const editor = editorRef.current.editor
    const range = editor.selection.getRng()

    editor.selection.setContent(`<span class="memory-anchor">${selectedText}</span>`)

    onAddMemoryAnchor(selectedText, {
      start: range.startOffset,
      end: range.endOffset
    })

    message.success('已添加记忆锚点')
  }

  // 添加伏笔标记
  const handleAddForeshadowing = () => {
    if (!selectedText || !onAddForeshadowing) return

    const editor = editorRef.current.editor
    const range = editor.selection.getRng()

    editor.selection.setContent(`<span class="foreshadowing">${selectedText}</span>`)

    onAddForeshadowing(selectedText, {
      start: range.startOffset,
      end: range.endOffset
    })

    message.success('已添加伏笔标记')
  }

  // 工具栏按钮操作
  const handleFormat = (command: string) => {
    if (!editorRef.current) return
    editorRef.current.editor.execCommand(command)
  }

  useEffect(() => {
    if (!editorRef.current) return

    const editor = editorRef.current.editor
    editor.on('SelectionChange', handleSelectionChange)

    return () => {
      editor.off('SelectionChange', handleSelectionChange)
    }
  }, [])

  return (
    <div className={styles.editorContainer}>
      <div className={styles.toolbar}>
        <Button.Group>
          <Tooltip title="加粗">
            <Button icon={<BoldOutlined />} onClick={() => handleFormat('Bold')} />
          </Tooltip>
          <Tooltip title="斜体">
            <Button icon={<ItalicOutlined />} onClick={() => handleFormat('Italic')} />
          </Tooltip>
          <Tooltip title="下划线">
            <Button icon={<UnderlineOutlined />} onClick={() => handleFormat('Underline')} />
          </Tooltip>
        </Button.Group>

        <Button.Group>
          <Tooltip title="有序列表">
            <Button icon={<OrderedListOutlined />} onClick={() => handleFormat('InsertOrderedList')} />
          </Tooltip>
          <Tooltip title="无序列表">
            <Button icon={<UnorderedListOutlined />} onClick={() => handleFormat('InsertUnorderedList')} />
          </Tooltip>
        </Button.Group>

        <Button.Group>
          <Tooltip title="撤销">
            <Button icon={<RollbackOutlined />} onClick={() => handleFormat('Undo')} />
          </Tooltip>
          <Tooltip title="重做">
            <Button icon={<RedoOutlined />} onClick={() => handleFormat('Redo')} />
          </Tooltip>
        </Button.Group>

        {!readOnly && (
          <Button.Group>
            <Tooltip title="添加记忆锚点">
              <Button icon={<TagOutlined />} onClick={handleAddMemoryAnchor} disabled={!selectedText} />
            </Tooltip>
            <Tooltip title="添加伏笔标记">
              <Button icon={<BulbOutlined />} onClick={handleAddForeshadowing} disabled={!selectedText} />
            </Tooltip>
          </Button.Group>
        )}
      </div>

      <TinyMCEEditor
        ref={editorRef}
        initialValue={content}
        init={initConfig}
        onEditorChange={handleEditorChange}
        disabled={readOnly}
      />
    </div>
  )
}
