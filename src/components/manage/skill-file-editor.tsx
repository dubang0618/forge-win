'use client'

import { useState, useEffect, useCallback } from 'react'
import { Folder, Save, WrapText, FileText, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CodeEditor } from '@/components/ui/code-editor'
import { useWordWrap } from '@/hooks/use-word-wrap'
import { MarkdownPreview } from '@/components/ui/markdown-preview'
import { useI18n } from '@/components/providers/i18n-provider'
import { GLOBAL_WORKSPACE_ID } from '@/lib/types'

type EditorMode = 'edit' | 'preview' | 'split'

interface SkillFileEditorProps {
  /** Relative path within skills/, e.g. "my-skill/SKILL.md" */
  filePath: string
}

interface SkillFile {
  name: string
  path: string
  isDirectory: boolean
}

export function SkillFileEditor({ filePath }: SkillFileEditorProps) {
  const { t } = useI18n()
  const [mode, setMode] = useState<EditorMode>('edit')
  const [content, setContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const { wordWrap, toggleWordWrap } = useWordWrap()

  // 文件夹相关状态
  const [isDirectory, setIsDirectory] = useState(false)
  const [files, setFiles] = useState<SkillFile[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)

  const workspaceId = GLOBAL_WORKSPACE_ID
  const forgePath = `skills/${filePath}`

  // 检查是否是文件夹并加载文件列表
  useEffect(() => {
    setLoading(true)
    setDirty(false)

    // 先尝试获取文件列表
    fetch(`/api/workspaces/${workspaceId}/skill-files?skillPath=${encodeURIComponent(filePath)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data && data.type === 'directory') {
          setIsDirectory(true)
          setFiles(data.files || [])
          // 默认选择 SKILL.md
          const defaultFile = data.files.find((f: SkillFile) => f.name === 'SKILL.md') || data.files[0]
          if (defaultFile) {
            setSelectedFile(defaultFile.path)
          }
          setLoading(false)
        } else {
          // 单文件模式
          setIsDirectory(false)
          setFiles([])
          setSelectedFile(null)
          // 加载文件内容
          fetch(`/api/workspaces/${workspaceId}/files?name=${encodeURIComponent(forgePath)}`)
            .then(r => r.ok ? r.json() : { content: '' })
            .then(data => { setContent(data.content || ''); setLoading(false) })
            .catch(() => { setContent(''); setLoading(false) })
        }
      })
      .catch(() => {
        setIsDirectory(false)
        setContent('')
        setLoading(false)
      })
  }, [filePath, workspaceId, forgePath])

  // 当选择的文件改变时，加载其内容
  useEffect(() => {
    if (!isDirectory || !selectedFile) return

    setLoading(true)
    const fullPath = `skills/${filePath}/${selectedFile}`
    fetch(`/api/workspaces/${workspaceId}/files?name=${encodeURIComponent(fullPath)}`)
      .then(r => r.ok ? r.json() : { content: '' })
      .then(data => { setContent(data.content || ''); setLoading(false); setDirty(false) })
      .catch(() => { setContent(''); setLoading(false) })
  }, [selectedFile, isDirectory, filePath, workspaceId])

  const handleSave = useCallback(async () => {
    const savePath = isDirectory && selectedFile
      ? `skills/${filePath}/${selectedFile}`
      : forgePath

    const res = await fetch(`/api/workspaces/${workspaceId}/files`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: savePath, content }),
    })
    if (res.ok) setDirty(false)
  }, [content, forgePath, workspaceId, isDirectory, selectedFile, filePath])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault()
      handleSave()
    }
  }, [handleSave])

  const displayName = filePath.split('/').pop() || filePath
  const currentFilePath = isDirectory && selectedFile
    ? `skills/${filePath}/${selectedFile}`
    : forgePath

  return (
    <div className="flex h-full" onKeyDown={handleKeyDown}>
      {/* 文件列表侧边栏 - 仅在文件夹模式下显示 */}
      {isDirectory && files.length > 0 && (
        <div className="w-64 border-r border-subtle bg-surface shrink-0 flex flex-col">
          <div className="h-11 px-4 border-b border-subtle flex items-center">
            <Folder size={14} className="text-muted mr-2" />
            <span className="text-[13px] font-medium text-secondary truncate">{displayName}</span>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {files.map((file) => (
              <button
                key={file.path}
                onClick={() => !file.isDirectory && setSelectedFile(file.path)}
                disabled={file.isDirectory}
                className={cn(
                  "w-full text-left px-3 py-1.5 rounded text-[12px] flex items-center gap-2 transition-colors",
                  !file.isDirectory && "hover:bg-surface-hover",
                  selectedFile === file.path && "bg-surface-active text-primary",
                  file.isDirectory && "opacity-50 cursor-not-allowed text-tertiary"
                )}
              >
                {file.isDirectory ? (
                  <ChevronRight size={14} className="shrink-0" />
                ) : (
                  <FileText size={14} className="shrink-0" />
                )}
                <span className="truncate">{file.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 编辑器主体 */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between h-11 px-6 border-b border-subtle shrink-0">
          <span className="text-[16px] font-semibold text-primary truncate">
            {isDirectory && selectedFile ? selectedFile.split('/').pop() : displayName}
          </span>
          <div className="flex items-center gap-2">
            {dirty && (
              <button
                onClick={handleSave}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-[12px] font-medium text-amber hover:bg-surface-hover transition-colors"
              >
                <Save size={12} />
                <span>{t('button.save')}</span>
              </button>
            )}
            <div className="flex items-center">
              {(['edit', 'preview', 'split'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setMode(tab)}
                  className={cn(
                    'px-2.5 py-1 text-[12px] font-medium transition-colors',
                    tab === 'edit' ? 'rounded-l-md' : tab === 'split' ? 'rounded-r-md' : '',
                    mode === tab
                      ? 'bg-surface-active text-primary'
                      : 'text-tertiary hover:text-secondary'
                  )}
                >
                  {tab === 'edit' ? 'Source' : tab === 'preview' ? 'Preview' : 'Split'}
                </button>
              ))}
            </div>
            <button
              onClick={toggleWordWrap}
              className={cn('p-1.5 rounded-md hover:bg-surface-hover transition-colors', wordWrap ? 'text-muted' : 'text-tertiary')}
              title={wordWrap ? 'Word wrap: on' : 'Word wrap: off'}
            >
              <WrapText size={14} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex">
          {loading ? (
            <div className="flex items-center justify-center flex-1 text-muted text-[13px]">{t('status.loading')}</div>
          ) : (
            <>
              {(mode === 'edit' || mode === 'split') && (
                <div className={cn('flex-1 overflow-hidden', mode === 'split' && 'border-r border-subtle')}>
                  <CodeEditor
                    value={content}
                    onChange={v => { setContent(v); setDirty(true) }}
                    language="markdown"
                    wordWrap={wordWrap}
                  />
                </div>
              )}
              {(mode === 'preview' || mode === 'split') && (
                <div className="flex-1 overflow-y-auto bg-page">
                  <MarkdownPreview content={content} />
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center h-8 px-6 border-t border-subtle shrink-0 bg-surface">
          <Folder size={12} className="text-muted" />
          <span className="text-[11px] text-muted ml-1.5 font-mono truncate">~/.claude/{currentFilePath}</span>
          <div className="flex-1" />
          <span className="text-[11px] text-muted">{t('hint.cmdSToSave')}</span>
        </div>
      </div>
    </div>
  )
}
