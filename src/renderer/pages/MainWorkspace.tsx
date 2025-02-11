import { BulbOutlined, EditOutlined, FileOutlined, SettingOutlined } from '@ant-design/icons'
import { Button, Layout, Menu, Spin } from 'antd'
import { useState } from 'react'

import Editor from '../components/Editor'
import ForeshadowPanel from '../components/ForeshadowPanel'
import MemoryPanel from '../components/MemoryPanel'
import Outline from '../components/Outline'
import SettingsPanel from '../components/SettingsPanel'
import { useForeshadow } from '../hooks/useForeshadow'
import { useMemory } from '../hooks/useMemory'
import { useNovel } from '../hooks/useNovel'
import styles from './MainWorkspace.module.less'

const { Header, Sider, Content } = Layout

export default function MainWorkspace() {
  const [collapsed, setCollapsed] = useState(false)
  const [activePanel, setActivePanel] = useState('editor')
  const [generating, setGenerating] = useState(false)

  const { novel, currentChapter, loading: novelLoading, saveChapter, generateChapter } = useNovel()

  const { memories, loading: memoryLoading, addMemoryAnchor } = useMemory(novel?.id)

  const { foreshadowings, loading: foreshadowLoading, addForeshadowing } = useForeshadow(novel?.id)

  // 处理章节生成
  const handleGenerate = async () => {
    if (!novel?.id || generating) return

    setGenerating(true)
    try {
      await generateChapter({
        novelId: novel.id,
        chapterNumber: currentChapter.number + 1
      })
    } finally {
      setGenerating(false)
    }
  }

  // 处理内容保存
  const handleSave = async (content: string) => {
    if (!novel?.id || !currentChapter?.id) return

    await saveChapter(currentChapter.id, content)
  }

  // 渲染侧边栏内容
  const renderSidePanel = () => {
    switch (activePanel) {
      case 'outline':
        return <Outline novel={novel} currentChapter={currentChapter} />
      case 'memory':
        return <MemoryPanel memories={memories} loading={memoryLoading} onAddMemory={addMemoryAnchor} />
      case 'foreshadow':
        return (
          <ForeshadowPanel
            foreshadowings={foreshadowings}
            loading={foreshadowLoading}
            onAddForeshadowing={addForeshadowing}
          />
        )
      case 'settings':
        return <SettingsPanel novel={novel} />
      default:
        return null
    }
  }

  if (novelLoading) {
    return (
      <div className={styles.loading}>
        <Spin size="large" tip="加载中..." />
      </div>
    )
  }

  return (
    <Layout className={styles.workspace}>
      <Header className={styles.header}>
        <div className={styles.title}>
          {novel?.title || '未命名小说'} - {currentChapter?.title || '新章节'}
        </div>
        <div className={styles.actions}>
          <Button type="primary" onClick={handleGenerate} loading={generating} className={styles.generateBtn}>
            生成下一章
          </Button>
        </div>
      </Header>

      <Layout>
        <Sider width={300} collapsible collapsed={collapsed} onCollapse={setCollapsed} className={styles.sider}>
          <Menu mode="inline" selectedKeys={[activePanel]} onSelect={({ key }) => setActivePanel(key as string)}>
            <Menu.Item key="outline" icon={<FileOutlined />}>
              大纲管理
            </Menu.Item>
            <Menu.Item key="editor" icon={<EditOutlined />}>
              内容编辑
            </Menu.Item>
            <Menu.Item key="memory" icon={<BulbOutlined />}>
              记忆管理
            </Menu.Item>
            <Menu.Item key="foreshadow" icon={<BulbOutlined />}>
              伏笔管理
            </Menu.Item>
            <Menu.Item key="settings" icon={<SettingOutlined />}>
              设置
            </Menu.Item>
          </Menu>

          <div className={styles.sideContent}>{renderSidePanel()}</div>
        </Sider>

        <Content className={styles.content}>
          <Editor content={currentChapter?.content || ''} onChange={handleSave} readOnly={generating} />
        </Content>
      </Layout>
    </Layout>
  )
}
