'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  ChevronRight, ChevronDown, Folder, FileText,
  FilePlus, FolderPlus, Search, Save, WrapText, Pencil, Trash2,
  Copy, Scissors, ClipboardPaste,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useI18n } from '@/components/providers/i18n-provider'
import { CodeEditor } from '@/components/ui/code-editor'
import { MarkdownPreview } from '@/components/ui/markdown-preview'
import { useWordWrap } from '@/hooks/use-word-wrap'
import { ResizeHandle } from '@/components/ui/resize-handle'

/* ── Types ── */

interface TreeNode {
  name: string
  type: 'file' | 'folder'
  path: string
  children?: TreeNode[]
}

type EditorMode = 'edit' | 'preview' | 'split'

interface ContextMenuState {
  x: number
  y: number
  targetPath: string
  targetType: 'file' | 'folder' | 'root'
}

interface TemplateEditorPanelProps {
  templateId: string
  templateName: string
}

/* ── Component ── */

function isTextEditingTarget(target: EventTarget | null) {
  const el = target instanceof HTMLElement ? target : null
  if (!el) return false
  if (el.isContentEditable) return true
  if (el.closest('[contenteditable="true"]')) return true
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

function isWithinTree(target: EventTarget | null, treeEl: HTMLElement | null) {
  const el = target instanceof Node ? target : null
  return !!(el && treeEl?.contains(el))
}

export function TemplateEditorPanel({ templateId, templateName }: TemplateEditorPanelProps) {
  const { t } = useI18n()

  // File tree state
  const [tree, setTree] = useState<TreeNode[]>([])
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
  const [treeSearch, setTreeSearch] = useState('')
  const [showTreeSearch, setShowTreeSearch] = useState(false)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [renaming, setRenaming] = useState<{ path: string; value: string } | null>(null)
  const [creating, setCreating] = useState<{ parentPath: string; type: 'file' | 'folder' } | null>(null)
  const [selectedNode, setSelectedNode] = useState<{ path: string; type: 'file' | 'folder' } | null>(null)
  const [clipboardState, setClipboardState] = useState<{ action: 'copy' | 'cut'; path: string } | null>(null)
  const [treeWidth, setTreeWidth] = useState(200)

  // Editor state
  const [content, setContent] = useState('')
  const [editorMode, setEditorMode] = useState<EditorMode>('edit')
  const [dirty, setDirty] = useState(false)
  const [fileLoading, setFileLoading] = useState(false)
  const { wordWrap, toggleWordWrap } = useWordWrap()

  // Drag & drop state — panelRef covers the entire editor panel for drop targets
  const panelRef = useRef<HTMLDivElement>(null)
  const treeRef = useRef<HTMLDivElement>(null)
  const editorPaneRef = useRef<HTMLDivElement>(null)
  const dragOverPathRef = useRef<string | null>(null)
  const draggedPathRef = useRef<string | null>(null)
  const [isDraggingExternal, setIsDraggingExternal] = useState(false)

  // Drag highlight via direct DOM manipulation
  const setDragHighlight = useCallback((newPath: string | null) => {
    const container = treeRef.current
    if (!container) return
    if (dragOverPathRef.current) {
      container.querySelector(`[data-drop-path="${CSS.escape(dragOverPathRef.current)}"]`)?.classList.remove('drop-target')
    }
    if (newPath) {
      container.querySelector(`[data-drop-path="${CSS.escape(newPath)}"]`)?.classList.add('drop-target')
    }
    dragOverPathRef.current = newPath
  }, [])

  /* ── Fetch tree ── */

  const fetchTree = useCallback(async () => {
    try {
      const res = await fetch(`/api/marketplace/${templateId}/tree`)
      const data = await res.json()
      setTree(data.tree || [])
    } catch {
      setTree([])
    }
  }, [templateId])

  useEffect(() => {
    fetchTree()
    setSelectedFilePath(null)
    setContent('')
    setDirty(false)
    setSelectedNode(null)
  }, [fetchTree, templateId])

  /* ── Fetch file content ── */

  useEffect(() => {
    if (!selectedFilePath) return
    setFileLoading(true)
    setDirty(false)
    fetch(`/api/marketplace/${templateId}/files?name=${encodeURIComponent(selectedFilePath)}`)
      .then((r) => (r.ok ? r.json() : { content: '' }))
      .then((data) => { setContent(data.content || ''); setFileLoading(false) })
      .catch(() => { setContent(''); setFileLoading(false) })
  }, [templateId, selectedFilePath])

  /* ── Save file ── */

  const handleSave = useCallback(async () => {
    if (!selectedFilePath) return
    const res = await fetch(`/api/marketplace/${templateId}/files`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: selectedFilePath, content }),
    })
    if (res.ok) setDirty(false)
  }, [templateId, selectedFilePath, content])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault()
      handleSave()
    }
  }, [handleSave])

  /* ── File tree operations ── */

  const handleCreate = useCallback((parentPath: string, type: 'file' | 'folder') => {
    setCreating({ parentPath, type })
  }, [])

  const getCreateParent = useCallback((): string => {
    if (!selectedNode) return ''
    if (selectedNode.type === 'folder') return selectedNode.path
    const lastSlash = selectedNode.path.lastIndexOf('/')
    return lastSlash >= 0 ? selectedNode.path.substring(0, lastSlash) : ''
  }, [selectedNode])

  const handleCreateSubmit = useCallback(async (name: string) => {
    if (!creating || !name.trim()) { setCreating(null); return }
    const relPath = creating.parentPath ? `${creating.parentPath}/${name.trim()}` : name.trim()
    try {
      await fetch(`/api/marketplace/${templateId}/fs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: relPath, type: creating.type, content: creating.type === 'file' ? '' : undefined }),
      })
      fetchTree()
    } catch { /* ignore */ }
    setCreating(null)
  }, [creating, templateId, fetchTree])

  const handleRename = useCallback(async (oldPath: string, newName: string) => {
    const dir = oldPath.includes('/') ? oldPath.substring(0, oldPath.lastIndexOf('/')) : ''
    const newPath = dir ? `${dir}/${newName}` : newName
    if (newPath === oldPath) { setRenaming(null); return }
    try {
      await fetch(`/api/marketplace/${templateId}/fs`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPath, newPath }),
      })
      if (selectedFilePath === oldPath) setSelectedFilePath(newPath)
      fetchTree()
    } catch { /* ignore */ }
    setRenaming(null)
  }, [templateId, fetchTree, selectedFilePath])

  const handleDelete = useCallback(async (relPath: string) => {
    try {
      await fetch(`/api/marketplace/${templateId}/fs?path=${encodeURIComponent(relPath)}`, {
        method: 'DELETE',
      })
      if (selectedFilePath === relPath || selectedFilePath?.startsWith(relPath + '/')) {
        setSelectedFilePath(null)
        setContent('')
        setDirty(false)
      }
      if (selectedNode?.path === relPath || selectedNode?.path.startsWith(relPath + '/')) {
        setSelectedNode(null)
      }
      if (clipboardState?.path === relPath || clipboardState?.path.startsWith(relPath + '/')) {
        setClipboardState(null)
      }
      fetchTree()
    } catch { /* ignore */ }
  }, [templateId, fetchTree, selectedFilePath, selectedNode, clipboardState])

  const handleCopy = useCallback((path: string) => {
    setClipboardState({ action: 'copy', path })
  }, [])

  const handleCut = useCallback((path: string) => {
    setClipboardState({ action: 'cut', path })
  }, [])

  /* ── Close context menu on click ── */

  useEffect(() => {
    if (!contextMenu) return
    const handler = () => setContextMenu(null)
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [contextMenu])

  /* ── Optimistic tree helpers ── */

  const addOptimisticNodes = useCallback((parentPath: string, names: string[], type: 'file' | 'folder') => {
    const newNodes: TreeNode[] = names.map(name => {
      const path = parentPath ? `${parentPath}/${name}` : name
      return { name, type, path, ...(type === 'folder' ? { children: [] } : {}) }
    })
    setTree(prev => insertNodesIntoTree(prev, parentPath, newNodes))
  }, [])

  /* ── OS clipboard paste ── */

  const handleClipboardPaste = useCallback(async (targetFolder: string) => {
    if (clipboardState) {
      const action = clipboardState.action === 'cut' ? 'move' : 'copy'
      console.log('[template-editor] internal paste start', { action, source: clipboardState.path, targetFolder })
      try {
        const res = await fetch(`/api/marketplace/${templateId}/fs`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: clipboardState.path, destination: targetFolder, action }),
        })
        console.log('[template-editor] internal paste response', { ok: res.ok, status: res.status })
        if (clipboardState.action === 'cut') setClipboardState(null)
        fetchTree()
      } catch (error) {
        console.error('[template-editor] internal paste failed', error)
      }
      return
    }

    const api = window.electronAPI
    if (api?.readClipboardFiles) {
      try {
        const files = await api.readClipboardFiles()
        console.log('[template-editor] clipboard files', { targetFolder, files })
        if (files.length > 0) {
          const names = files.map(f => f.split('/').pop()!).filter(Boolean)
          if (names.length > 0) addOptimisticNodes(targetFolder, names, 'folder')

          const res = await fetch(`/api/marketplace/${templateId}/fs/import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sourcePaths: files,
              destinationFolder: targetFolder,
            }),
          })
          console.log('[template-editor] import response', { ok: res.ok, status: res.status })
          fetchTree()
          if (!res.ok) console.warn('[template-editor] import failed body:', await res.text())
        } else {
          console.warn('[template-editor] no clipboard files returned')
        }
      } catch (error) {
        console.error('[template-editor] clipboard paste failed', error)
        fetchTree()
      }
    } else {
      console.warn('[template-editor] electron clipboard API unavailable')
    }
  }, [clipboardState, templateId, fetchTree, addOptimisticNodes])

  /* ── Keyboard shortcuts on tree container ── */

  useEffect(() => {
    const el = panelRef.current
    if (!el) return

    const handler = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey
      if (!isMod && e.key !== 'F2') return
      if (isTextEditingTarget(e.target)) return

      const treeEl = treeRef.current
      const activeElement = document.activeElement
      const treeHasFocus = !!treeEl && (treeEl === activeElement || treeEl.contains(activeElement))
      const editorHasFocus = !!editorPaneRef.current && !!activeElement && editorPaneRef.current.contains(activeElement)
      const emptyStateHasFocus = activeElement instanceof HTMLElement && activeElement.dataset.emptyStatePaste === 'true'
      const eventCameFromTree = isWithinTree(e.target, treeEl)
      const shouldHandleTreeShortcut = treeHasFocus || eventCameFromTree || emptyStateHasFocus

      if (editorHasFocus && !emptyStateHasFocus) return

      if (e.key === 'F2') {
        if (!shouldHandleTreeShortcut || !selectedNode) return
        e.preventDefault()
        const name = selectedNode.path.split('/').pop() || ''
        setRenaming({ path: selectedNode.path, value: name })
        return
      }

      if (!shouldHandleTreeShortcut) return

      if (e.key === 'v') {
        e.preventDefault()
        const targetFolder = !selectedNode ? ''
          : selectedNode.type === 'folder' ? selectedNode.path
          : (selectedNode.path.includes('/') ? selectedNode.path.substring(0, selectedNode.path.lastIndexOf('/')) : '')
        handleClipboardPaste(targetFolder)
        return
      }

      if (!selectedNode) return

      if (e.key === 'c' && !e.shiftKey) {
        e.preventDefault()
        handleCopy(selectedNode.path)
      } else if (e.key === 'x') {
        e.preventDefault()
        handleCut(selectedNode.path)
      }
    }

    el.addEventListener('keydown', handler)
    return () => el.removeEventListener('keydown', handler)
  }, [selectedNode, handleClipboardPaste, handleCopy, handleCut])

  /* ── Drag & drop: source handlers ── */

  const handleDragStart = useCallback((e: React.DragEvent, path: string) => {
    draggedPathRef.current = path
    e.dataTransfer.setData('forge/tree-path', path)
    e.dataTransfer.effectAllowed = 'move'
  }, [])

  const handleDragEnd = useCallback(() => {
    draggedPathRef.current = null
    setDragHighlight(null)
    setIsDraggingExternal(false)
  }, [setDragHighlight])

  /* ── Drag & drop: native DOM event delegation for targets ── */

  const fetchTreeRef = useRef(fetchTree)
  fetchTreeRef.current = fetchTree
  const addOptimisticNodesRef = useRef(addOptimisticNodes)
  addOptimisticNodesRef.current = addOptimisticNodes

  useEffect(() => {
    const container = panelRef.current
    if (!container) return

    const hasType = (dt: DataTransfer | null, type: string) => {
      const t = dt?.types
      if (!t) return false
      return typeof t.includes === 'function' ? t.includes(type) : (t as unknown as DOMStringList).contains(type)
    }

    const handleDragOver = (e: DragEvent) => {
      const isInternal = draggedPathRef.current != null
      const isExternal = hasType(e.dataTransfer, 'Files')
      if (!isInternal && !isExternal) return

      e.preventDefault()
      e.stopPropagation()

      const target = (e.target as HTMLElement).closest('[data-drop-path]') as HTMLElement | null
      if (target) {
        e.stopPropagation()
        const folderPath = target.getAttribute('data-drop-path')!
        if (e.dataTransfer) e.dataTransfer.dropEffect = isInternal ? 'move' : 'copy'
        setDragHighlight(folderPath)
      } else {
        if (e.dataTransfer) e.dataTransfer.dropEffect = isInternal ? 'move' : 'copy'
        setDragHighlight(null)
        if (isExternal) setIsDraggingExternal(true)
      }
    }

    const handleDrop = async (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setDragHighlight(null)
      setIsDraggingExternal(false)

      const target = (e.target as HTMLElement).closest('[data-drop-path]') as HTMLElement | null
      const folderPath = target?.getAttribute('data-drop-path') ?? null

      // Internal drag
      const sourcePath = draggedPathRef.current || e.dataTransfer?.getData('forge/tree-path')
      draggedPathRef.current = null

      if (sourcePath) {
        // Move within template - use PATCH for rename/move
        const fileName = sourcePath.split('/').pop()!
        const newPath = folderPath ? `${folderPath}/${fileName}` : fileName
        if (sourcePath === newPath || (folderPath && folderPath.startsWith(sourcePath + '/'))) return
        try {
          await fetch(`/api/marketplace/${templateId}/fs`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ oldPath: sourcePath, newPath }),
          })
          fetchTreeRef.current()
        } catch { /* ignore */ }
        return
      }

      // External file drop from OS
      const files = e.dataTransfer?.files
      if (files && files.length > 0) {
        const sourcePaths: string[] = []
        for (let i = 0; i < files.length; i++) {
          const file = files[i] as File & { path?: string }
          if (file.path) sourcePaths.push(file.path)
        }
        if (sourcePaths.length > 0) {
          // Optimistic: add placeholder nodes immediately
          const names = sourcePaths.map(p => p.split('/').pop()!).filter(Boolean)
          if (names.length > 0) addOptimisticNodesRef.current(folderPath || '', names, 'folder')

          try {
            await fetch(`/api/marketplace/${templateId}/fs/import`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                sourcePaths,
                destinationFolder: folderPath || '',
              }),
            })
          } catch { /* ignore */ }
          fetchTreeRef.current() // always refresh to get real state
        }
      }
    }

    const handleDragLeave = (e: DragEvent) => {
      if (!container.contains(e.relatedTarget as Node)) {
        setDragHighlight(null)
        setIsDraggingExternal(false)
      }
    }

    const handleDragEnter = (e: DragEvent) => {
      const isInternal = draggedPathRef.current != null
      const isExternal = hasType(e.dataTransfer, 'Files')
      if (isInternal || isExternal) e.preventDefault()
    }

    container.addEventListener('dragover', handleDragOver)
    container.addEventListener('dragenter', handleDragEnter)
    container.addEventListener('drop', handleDrop)
    container.addEventListener('dragleave', handleDragLeave)

    return () => {
      container.removeEventListener('dragover', handleDragOver)
      container.removeEventListener('dragenter', handleDragEnter)
      container.removeEventListener('drop', handleDrop)
      container.removeEventListener('dragleave', handleDragLeave)
    }
  }, [templateId, setDragHighlight])

  const handleTreeResize = useCallback((delta: number) => {
    setTreeWidth((w) => Math.max(120, Math.min(400, w + delta)))
  }, [])

  const filteredTree = treeSearch ? filterTree(tree, treeSearch.toLowerCase()) : tree
  const displayName = selectedFilePath?.split('/').pop() || templateName

  return (
    <div ref={panelRef} tabIndex={0} className={cn('flex h-full outline-none', isDraggingExternal && 'ring-2 ring-indigo/40 ring-inset')} onKeyDown={handleKeyDown}>
      {/* File Tree */}
      <div className="border-r border-subtle shrink-0 flex flex-col overflow-hidden" style={{ width: treeWidth }}>
        {/* Tree header */}
        <div className="flex items-center justify-between h-11 px-3.5 border-b border-subtle shrink-0">
          <span className="text-[12px] font-semibold text-primary truncate">{templateName}</span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setShowTreeSearch((v) => !v)}
              className="text-tertiary hover:text-secondary transition-colors"
              title={t('button.search')}
            >
              <Search size={13} />
            </button>
            <button
              onClick={() => handleCreate(getCreateParent(), 'file')}
              className="text-indigo hover:opacity-80 transition-opacity"
              title={t('button.newFile')}
            >
              <FilePlus size={13} />
            </button>
            <button
              onClick={() => handleCreate(getCreateParent(), 'folder')}
              className="text-indigo hover:opacity-80 transition-opacity"
              title={t('button.newFolder')}
            >
              <FolderPlus size={13} />
            </button>
          </div>
        </div>

        {/* Tree search */}
        {showTreeSearch && (
          <div className="px-3 py-2">
            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-elevated">
              <Search size={12} className="text-muted shrink-0" />
              <input
                value={treeSearch}
                onChange={(e) => setTreeSearch(e.target.value)}
                placeholder={t('input.searchFiles')}
                className="flex-1 bg-transparent text-[11px] text-primary placeholder:text-muted outline-none"
                autoFocus
              />
            </div>
          </div>
        )}

        {/* File tree */}
        <div
          ref={treeRef}
          tabIndex={0}
          className="flex-1 overflow-y-auto min-h-0 px-2 py-1 outline-none"
        >
          {/* Inline create at root */}
          {creating && creating.parentPath === '' && (
            <InlineCreateInput
              type={creating.type}
              onSubmit={handleCreateSubmit}
              onCancel={() => setCreating(null)}
              depth={0}
            />
          )}
          {filteredTree.length === 0 && !creating && (
            <div className="px-3 py-6 text-center">
              <span className="text-[11px] text-muted">
                {treeSearch ? 'No matching files' : t('marketplace.noFiles')}
              </span>
            </div>
          )}
          {filteredTree.map((node) => (
            <FileTreeItem
              key={node.path}
              node={node}
              depth={0}
              selectedPath={selectedNode?.path ?? null}
              clipboardCutPath={clipboardState?.action === 'cut' ? clipboardState.path : null}
              onSelect={(path) => setSelectedFilePath(path)}
              onSelectNode={setSelectedNode}
              onContextMenu={(e, path, type) => {
                e.preventDefault()
                e.stopPropagation()
                setContextMenu({ x: e.clientX, y: e.clientY, targetPath: path, targetType: type })
              }}
              renaming={renaming}
              onRenameSubmit={handleRename}
              onRenameCancel={() => setRenaming(null)}
              creating={creating}
              onCreateSubmit={handleCreateSubmit}
              onCreateCancel={() => setCreating(null)}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            />
          ))}
        </div>

        {/* Context Menu */}
        {contextMenu && (
          <div
            className="fixed bg-surface border border-subtle rounded-lg shadow-lg z-50 py-1 w-[160px] animate-slide-down"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            {(contextMenu.targetType === 'folder' || contextMenu.targetType === 'root') && (
              <>
                <button
                  onClick={() => { handleCreate(contextMenu.targetPath, 'file'); setContextMenu(null) }}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] text-primary hover:bg-surface-hover transition-colors"
                >
                  <FilePlus size={12} className="text-tertiary" /> {t('button.newFile')}
                </button>
                <button
                  onClick={() => { handleCreate(contextMenu.targetPath, 'folder'); setContextMenu(null) }}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] text-primary hover:bg-surface-hover transition-colors"
                >
                  <FolderPlus size={12} className="text-tertiary" /> {t('button.newFolder')}
                </button>
                <div className="h-px bg-subtle mx-2 my-1" />
                <button
                  onClick={() => {
                    handleClipboardPaste(contextMenu.targetPath)
                    setContextMenu(null)
                  }}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] text-primary hover:bg-surface-hover transition-colors"
                >
                  <ClipboardPaste size={12} className="text-tertiary" /> {t('contextMenu.paste')}
                </button>
                <div className="h-px bg-subtle mx-2 my-1" />
              </>
            )}
            {contextMenu.targetType === 'root' && (
              <button
                onClick={() => {
                  handleClipboardPaste('')
                  setContextMenu(null)
                }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] text-primary hover:bg-surface-hover transition-colors"
              >
                <ClipboardPaste size={12} className="text-tertiary" /> {t('contextMenu.paste')}
              </button>
            )}
            {contextMenu.targetType !== 'root' && (
              <>
                <button
                  onClick={() => {
                    handleCopy(contextMenu.targetPath)
                    setContextMenu(null)
                  }}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] text-primary hover:bg-surface-hover transition-colors"
                >
                  <Copy size={12} className="text-tertiary" /> {t('contextMenu.copy')}
                </button>
                <button
                  onClick={() => {
                    handleCut(contextMenu.targetPath)
                    setContextMenu(null)
                  }}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] text-primary hover:bg-surface-hover transition-colors"
                >
                  <Scissors size={12} className="text-tertiary" /> {t('contextMenu.cut')}
                </button>
                <button
                  onClick={() => {
                    const name = contextMenu.targetPath.split('/').pop() || ''
                    setRenaming({ path: contextMenu.targetPath, value: name })
                    setContextMenu(null)
                  }}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] text-primary hover:bg-surface-hover transition-colors"
                >
                  <Pencil size={12} className="text-tertiary" /> {t('contextMenu.rename')}
                </button>
                <button
                  onClick={() => { handleDelete(contextMenu.targetPath); setContextMenu(null) }}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] text-coral hover:bg-surface-hover transition-colors"
                >
                  <Trash2 size={12} /> {t('contextMenu.delete')}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Resize handle */}
      <ResizeHandle direction="horizontal" onResize={handleTreeResize} />

      {/* Editor */}
      <div className="flex-1 overflow-hidden min-w-0 flex flex-col">
        {selectedFilePath ? (
          <>
            {/* Editor header */}
            <div className="flex items-center justify-between h-11 px-6 border-b border-subtle shrink-0">
              <span className="text-[16px] font-semibold text-primary truncate">{displayName}</span>
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
                  {(['edit', 'preview', 'split'] as const).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setEditorMode(tab)}
                      className={cn(
                        'px-2.5 py-1 text-[12px] font-medium transition-colors',
                        tab === 'edit' ? 'rounded-l-md' : tab === 'split' ? 'rounded-r-md' : '',
                        editorMode === tab
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

            {/* Editor content */}
            <div className="flex-1 overflow-hidden flex">
              {fileLoading ? (
                <div className="flex items-center justify-center flex-1 text-muted text-[13px]">{t('common.loading')}</div>
              ) : (
                <>
                  {(editorMode === 'edit' || editorMode === 'split') && (
                    <div className={cn('flex-1 overflow-hidden', editorMode === 'split' && 'border-r border-subtle')} ref={editorPaneRef}>
                      <CodeEditor
                        value={content}
                        onChange={(v) => { setContent(v); setDirty(true) }}
                        language="markdown"
                        wordWrap={wordWrap}
                      />
                    </div>
                  )}
                  {(editorMode === 'preview' || editorMode === 'split') && (
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
              <span className="text-[11px] text-muted ml-1.5 font-mono truncate">{selectedFilePath}</span>
              <div className="flex-1" />
              <span className="text-[11px] text-muted">{t('hint.cmdSToSave')}</span>
            </div>
          </>
        ) : (
          /* Empty state: no file selected */
          <div
            className="flex items-center justify-center h-full cursor-pointer"
            tabIndex={0}
            data-empty-state-paste="true"
            onClick={(e) => (e.currentTarget as HTMLDivElement).focus()}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setContextMenu({ x: e.clientX, y: e.clientY, targetPath: '', targetType: 'root' })
            }}
            onKeyDown={(e) => {
              const isMod = e.metaKey || e.ctrlKey
              if (isMod && e.key === 'v') {
                e.preventDefault()
                void handleClipboardPaste('')
              }
            }}
          >
            <div className="text-center">
              <div className="w-12 h-12 rounded-xl bg-elevated flex items-center justify-center mx-auto mb-3">
                <FileText size={24} className="text-tertiary" />
              </div>
              <p className="text-[13px] text-secondary">{t('marketplace.selectFile')}</p>
              <div className="mt-3 flex flex-col items-center gap-2">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    void handleClipboardPaste('')
                  }}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-[12px] font-medium text-primary bg-elevated hover:bg-surface-hover transition-colors"
                >
                  <ClipboardPaste size={12} className="text-tertiary" />
                  <span>{t('contextMenu.paste')}</span>
                </button>
                <p className="text-[11px] text-muted">Ctrl+V 可粘贴文件到模板根目录</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ── FileTreeItem ── */

function FileTreeItem({
  node, depth, selectedPath, clipboardCutPath, onSelect, onSelectNode, onContextMenu,
  renaming, onRenameSubmit, onRenameCancel,
  creating, onCreateSubmit, onCreateCancel,
  onDragStart, onDragEnd,
}: {
  node: TreeNode
  depth: number
  selectedPath: string | null
  clipboardCutPath: string | null
  onSelect: (path: string) => void
  onSelectNode: (node: { path: string; type: 'file' | 'folder' }) => void
  onContextMenu: (e: React.MouseEvent, path: string, type: 'file' | 'folder') => void
  renaming: { path: string; value: string } | null
  onRenameSubmit: (oldPath: string, newName: string) => void
  onRenameCancel: () => void
  creating: { parentPath: string; type: 'file' | 'folder' } | null
  onCreateSubmit: (name: string) => void
  onCreateCancel: () => void
  onDragStart: (e: React.DragEvent, path: string) => void
  onDragEnd: () => void
}) {
  const [expanded, setExpanded] = useState(depth < 2)
  const isFolder = node.type === 'folder'
  const isSelected = selectedPath === node.path
  const isCut = clipboardCutPath === node.path
  const isRenaming = renaming?.path === node.path
  const wasDragged = useRef(false)

  // Auto-expand folder when creating inside it
  useEffect(() => {
    if (creating && creating.parentPath === node.path) {
      setExpanded(true)
    }
  }, [creating, node.path])

  return (
    <div>
      <div
        draggable={!isRenaming}
        data-drop-path={isFolder ? node.path : undefined}
        onClick={() => {
          if (wasDragged.current) return
          onSelectNode({ path: node.path, type: node.type })
          if (isFolder) { setExpanded(!expanded) } else { onSelect(node.path) }
        }}
        onContextMenu={(e) => onContextMenu(e, node.path, node.type)}
        onDragStart={(e) => { wasDragged.current = true; onDragStart(e, node.path) }}
        onDragEnd={() => { setTimeout(() => { wasDragged.current = false }, 100); onDragEnd() }}
        className={cn(
          'flex items-center gap-1 w-full h-[26px] px-1.5 rounded cursor-pointer transition-colors',
          isSelected ? 'bg-elevated' : 'hover:bg-surface-hover',
          isCut && 'opacity-50'
        )}
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
      >
        {isFolder ? (
          <>
            {expanded
              ? <ChevronDown size={12} className="text-tertiary shrink-0" />
              : <ChevronRight size={12} className="text-tertiary shrink-0" />}
            <Folder size={13} className={cn('shrink-0', isSelected ? 'text-indigo' : 'text-tertiary')} />
          </>
        ) : (
          <>
            <span className="w-3 shrink-0" />
            <FileText size={13} className="text-tertiary shrink-0" />
          </>
        )}
        {isRenaming ? (
          <input
            autoFocus
            defaultValue={renaming.value}
            className="text-[11px] text-primary bg-transparent outline-none border-b border-indigo flex-1"
            onBlur={(e) => onRenameSubmit(node.path, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onRenameSubmit(node.path, e.currentTarget.value)
              if (e.key === 'Escape') onRenameCancel()
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className={cn(
            'text-[11px] truncate flex-1',
            isFolder ? 'text-primary font-medium' : 'text-secondary'
          )}>
            {node.name}
          </span>
        )}
      </div>
      {isFolder && expanded && node.children && (
        <div>
          {creating && creating.parentPath === node.path && (
            <InlineCreateInput
              type={creating.type}
              onSubmit={onCreateSubmit}
              onCancel={onCreateCancel}
              depth={depth + 1}
            />
          )}
          {node.children.map((child) => (
            <FileTreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              clipboardCutPath={clipboardCutPath}
              onSelect={onSelect}
              onSelectNode={onSelectNode}
              onContextMenu={onContextMenu}
              renaming={renaming}
              onRenameSubmit={onRenameSubmit}
              onRenameCancel={onRenameCancel}
              creating={creating}
              onCreateSubmit={onCreateSubmit}
              onCreateCancel={onCreateCancel}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Inline Create Input ── */

function InlineCreateInput({
  type, onSubmit, onCancel, depth,
}: {
  type: 'file' | 'folder'
  onSubmit: (name: string) => void
  onCancel: () => void
  depth: number
}) {
  const { t } = useI18n()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(timer)
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const val = e.currentTarget.value.trim()
      if (val) onSubmit(val)
      else onCancel()
    }
    if (e.key === 'Escape') onCancel()
  }

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const val = e.target.value.trim()
    if (val) onSubmit(val)
    else onCancel()
  }

  return (
    <div
      className="flex items-center gap-1 h-[26px] px-1.5 rounded"
      style={{ paddingLeft: `${depth * 16 + 4}px` }}
    >
      <span className="w-3 shrink-0" />
      {type === 'folder' ? (
        <Folder size={13} className="text-amber shrink-0" />
      ) : (
        <FileText size={13} className="text-tertiary shrink-0" />
      )}
      <input
        ref={inputRef}
        type="text"
        className="flex-1 text-[11px] text-primary bg-elevated outline-none border border-indigo/50 rounded px-1.5 py-0.5 h-[20px]"
        placeholder={type === 'folder' ? t('input.folderName') : t('input.fileName')}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
      />
    </div>
  )
}

/* ── Filter helper ── */

function filterTree(nodes: TreeNode[], query: string): TreeNode[] {
  return nodes
    .map((node) => {
      if (node.type === 'folder' && node.children) {
        const filteredChildren = filterTree(node.children, query)
        if (filteredChildren.length > 0 || node.name.toLowerCase().includes(query)) {
          return { ...node, children: filteredChildren }
        }
        return null
      }
      return node.name.toLowerCase().includes(query) ? node : null
    })
    .filter((n): n is TreeNode => n !== null)
}

/* ── Optimistic tree insertion helper ── */

function insertNodesIntoTree(tree: TreeNode[], parentPath: string, newNodes: TreeNode[]): TreeNode[] {
  if (!parentPath) {
    // Insert at root, skip duplicates
    const existingNames = new Set(tree.map(n => n.name))
    const unique = newNodes.filter(n => !existingNames.has(n.name))
    return [...tree, ...unique]
  }
  return tree.map(node => {
    if (node.path === parentPath && node.type === 'folder') {
      const existingNames = new Set((node.children || []).map(n => n.name))
      const unique = newNodes.filter(n => !existingNames.has(n.name))
      return { ...node, children: [...(node.children || []), ...unique] }
    }
    if (node.children && parentPath.startsWith(node.path + '/')) {
      return { ...node, children: insertNodesIntoTree(node.children, parentPath, newNodes) }
    }
    return node
  })
}
