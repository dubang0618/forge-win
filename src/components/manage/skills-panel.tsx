'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Search, FilePlus, FolderPlus, ChevronRight, ChevronDown,
  Folder, FileText, Copy, Scissors, ClipboardPaste, Pencil, Trash2, Link,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useI18n } from '@/components/providers/i18n-provider'
import { GLOBAL_WORKSPACE_ID } from '@/lib/types'

interface SkillTreeNode {
  name: string
  type: 'file' | 'folder'
  path: string
  children?: SkillTreeNode[]
  enabled?: boolean
  isSymlink?: boolean
}

interface ContextMenuState {
  x: number
  y: number
  targetPath: string
  targetType: 'file' | 'folder' | 'root'
}

interface SkillsPanelProps {
  onSelectFile: (path: string) => void
  selectedPath: string | null
}

export function SkillsPanel({ onSelectFile, selectedPath }: SkillsPanelProps) {
  const { t } = useI18n()
  const [tree, setTree] = useState<SkillTreeNode[]>([])
  const [search, setSearch] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [renaming, setRenaming] = useState<{ path: string; value: string } | null>(null)
  const [creating, setCreating] = useState<{ parentPath: string; type: 'file' | 'folder' } | null>(null)
  const [selectedNode, setSelectedNode] = useState<{ path: string; type: 'file' | 'folder' } | null>(null)

  // Clipboard state
  const [clipboardState, setClipboardState] = useState<{ action: 'copy' | 'cut'; path: string } | null>(null)

  // Drag & drop state
  const treeRef = useRef<HTMLDivElement>(null)
  const dragOverPathRef = useRef<string | null>(null)
  const draggedPathRef = useRef<string | null>(null)
  const [isDraggingExternal, setIsDraggingExternal] = useState(false)

  // Update drag highlight via direct DOM manipulation (no React re-renders)
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

  // Sync parent's selectedPath into internal selection state
  useEffect(() => {
    if (selectedPath) {
      setSelectedNode({ path: selectedPath, type: 'file' })
    }
  }, [selectedPath])

  const workspaceId = GLOBAL_WORKSPACE_ID

  const fetchTree = useCallback(async () => {
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/skills-tree`)
      const data = await res.json()
      setTree(data.tree || [])
    } catch {
      setTree([])
    }
  }, [workspaceId])

  useEffect(() => { fetchTree() }, [fetchTree])

  // Close context menu on click
  useEffect(() => {
    if (!contextMenu) return
    const handler = () => setContextMenu(null)
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [contextMenu])

  const handleCreate = useCallback((parentPath: string, type: 'file' | 'folder') => {
    setCreating({ parentPath, type })
  }, [])

  // Determine create parent based on current selection (matches right sidebar logic)
  const getCreateParent = useCallback((): string => {
    if (!selectedNode) return ''
    if (selectedNode.type === 'folder') return selectedNode.path
    // File: use parent directory
    const lastSlash = selectedNode.path.lastIndexOf('/')
    return lastSlash >= 0 ? selectedNode.path.substring(0, lastSlash) : ''
  }, [selectedNode])

  const handleCreateSubmit = useCallback(async (name: string) => {
    if (!creating || !name.trim()) { setCreating(null); return }
    const relPath = creating.parentPath ? `skills/${creating.parentPath}/${name.trim()}` : `skills/${name.trim()}`
    try {
      await fetch(`/api/workspaces/${workspaceId}/fs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: relPath, type: creating.type, content: creating.type === 'file' ? '' : undefined }),
      })
      fetchTree()
    } catch { /* ignore */ }
    setCreating(null)
  }, [creating, workspaceId, fetchTree])

  const handleRename = useCallback(async (oldPath: string, newName: string) => {
    const dir = oldPath.includes('/') ? oldPath.substring(0, oldPath.lastIndexOf('/')) : ''
    const newPath = dir ? `${dir}/${newName}` : newName
    if (newPath === oldPath) { setRenaming(null); return }
    try {
      await fetch(`/api/workspaces/${workspaceId}/fs`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPath: `skills/${oldPath}`, newPath: `skills/${newPath}` }),
      })
      fetchTree()
    } catch { /* ignore */ }
    setRenaming(null)
  }, [workspaceId, fetchTree])

  const handleDelete = useCallback(async (relPath: string) => {
    try {
      console.log('[SkillsPanel] Deleting:', { relPath, workspaceId })
      const res = await fetch(`/api/workspaces/${workspaceId}/fs?path=${encodeURIComponent(`skills/${relPath}`)}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const error = await res.text()
        console.error('[SkillsPanel] Delete failed:', error)
        return
      }
      console.log('[SkillsPanel] Delete successful, refreshing tree')
      // Add delay to avoid race conditions with file watcher
      await new Promise(resolve => setTimeout(resolve, 100))
      await fetchTree()
      console.log('[SkillsPanel] Tree refreshed')
    } catch (err) {
      console.error('[SkillsPanel] Delete error:', err)
    }
  }, [workspaceId, fetchTree])

  // ── Clipboard: Copy / Cut / Paste ──

  const handleCopy = useCallback((path: string) => {
    setClipboardState({ action: 'copy', path })
  }, [])

  const handleCut = useCallback((path: string) => {
    setClipboardState({ action: 'cut', path })
  }, [])

  /* ── Optimistic tree helpers ── */

  const addOptimisticNodes = useCallback((parentPath: string, names: string[], type: 'file' | 'folder') => {
    const newNodes: SkillTreeNode[] = names.map(name => {
      const path = parentPath ? `${parentPath}/${name}` : name
      return { name, type, path, ...(type === 'folder' ? { children: [] } : {}) }
    })
    setTree(prev => insertSkillNodesIntoTree(prev, parentPath, newNodes))
  }, [])

  const shortcutLabel = window.electronAPI?.platform === 'darwin' ? '⌘' : 'Ctrl+'

  const handlePaste = useCallback(async (targetFolder: string) => {
    // Internal clipboard paste
    if (clipboardState) {
      const action = clipboardState.action === 'cut' ? 'move' : 'copy'
      console.log('[skills-panel] internal paste start', { action, source: clipboardState.path, targetFolder })
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/fs`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source: `skills/${clipboardState.path}`,
            destination: targetFolder ? `skills/${targetFolder}` : 'skills',
            action,
          }),
        })
        console.log('[skills-panel] internal paste response', { ok: res.ok, status: res.status })
        if (clipboardState.action === 'cut') setClipboardState(null)
        fetchTree()
      } catch (error) {
        console.error('[skills-panel] internal paste failed', error)
      }
      return
    }

    // OS clipboard paste
    const api = window.electronAPI
    if (api?.readClipboardFiles) {
      try {
        const files = await api.readClipboardFiles()
        console.log('[skills-panel] clipboard files', { targetFolder, files })
        if (files.length > 0) {
          // Optimistic: add placeholder nodes immediately
          const names = files.map(f => f.split('/').pop()!).filter(Boolean)
          if (names.length > 0) addOptimisticNodes(targetFolder, names, 'folder')

          const res = await fetch(`/api/workspaces/${workspaceId}/fs/import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sourcePaths: files,
              destinationFolder: targetFolder ? `skills/${targetFolder}` : 'skills',
            }),
          })
          console.log('[skills-panel] import response', { ok: res.ok, status: res.status })
          fetchTree()
          if (!res.ok) console.warn('[skills-panel] import failed body:', await res.text())
        } else {
          console.warn('[skills-panel] no clipboard files returned')
        }
      } catch (error) {
        console.error('[skills-panel] clipboard paste failed', error)
        fetchTree()
      }
    } else {
      console.warn('[skills-panel] electron clipboard API unavailable')
    }
  }, [clipboardState, workspaceId, fetchTree, addOptimisticNodes])

  // ── Keyboard shortcuts on tree container ──

  useEffect(() => {
    const el = treeRef.current
    if (!el) return

    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      const isMod = e.metaKey || e.ctrlKey

      // Paste: works even without selection (paste to root)
      if (isMod && e.key === 'v') {
        e.preventDefault()
        const targetFolder = !selectedNode ? ''
          : selectedNode.type === 'folder' ? selectedNode.path
          : (selectedNode.path.includes('/') ? selectedNode.path.substring(0, selectedNode.path.lastIndexOf('/')) : '')
        handlePaste(targetFolder)
        return
      }

      // Other shortcuts require a selection
      if (!selectedNode) return

      // F2: rename
      if (e.key === 'F2') {
        e.preventDefault()
        const name = selectedNode.path.split('/').pop() || ''
        setRenaming({ path: selectedNode.path, value: name })
        return
      }

      if (!isMod) return
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
  }, [selectedNode, handleCopy, handleCut, handlePaste])


  // ── Drag & drop: source handlers (React events on individual items) ──

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

  // ── Drag & drop: target handlers via native DOM event delegation ──
  // Uses native addEventListener instead of React synthetic events to ensure
  // reliable event handling in all contexts (Electron, nested components, etc.)

  const fetchTreeRef = useRef(fetchTree)
  fetchTreeRef.current = fetchTree
  const addOptimisticNodesRef = useRef(addOptimisticNodes)
  addOptimisticNodesRef.current = addOptimisticNodes

  useEffect(() => {
    const container = treeRef.current
    if (!container) return

    // Native DragEvent.types may be a DOMStringList (has .contains()) rather than
    // a real Array (has .includes()). This helper works with both.
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

      // Find the nearest folder drop target under the cursor
      const target = (e.target as HTMLElement).closest('[data-drop-path]') as HTMLElement | null
      if (target) {
        e.stopPropagation()
        const folderPath = target.getAttribute('data-drop-path')!
        if (e.dataTransfer) e.dataTransfer.dropEffect = isInternal ? 'move' : 'copy'
        setDragHighlight(folderPath)
      } else {
        // Root level (empty space)
        if (e.dataTransfer) e.dataTransfer.dropEffect = isInternal ? 'move' : 'copy'
        setDragHighlight(null)
        if (isExternal) setIsDraggingExternal(true)
      }
    }

    const handleDrop = async (e: DragEvent) => {
      e.preventDefault()
      setDragHighlight(null)
      setIsDraggingExternal(false)

      // Determine drop target: folder or root
      const target = (e.target as HTMLElement).closest('[data-drop-path]') as HTMLElement | null
      const folderPath = target?.getAttribute('data-drop-path') ?? null

      // Internal drag (move within skills/)
      const sourcePath = draggedPathRef.current || e.dataTransfer?.getData('forge/tree-path')
      draggedPathRef.current = null

      if (sourcePath) {
        if (folderPath) {
          // Drop onto a folder
          if (sourcePath === folderPath || folderPath.startsWith(sourcePath + '/')) return
          try {
            await fetch(`/api/workspaces/${workspaceId}/fs`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                source: `skills/${sourcePath}`,
                destination: `skills/${folderPath}`,
                action: 'move',
              }),
            })
            fetchTreeRef.current()
          } catch { /* ignore */ }
        } else {
          // Drop onto root (empty space)
          if (!sourcePath.includes('/')) return // already at root
          try {
            await fetch(`/api/workspaces/${workspaceId}/fs`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                source: `skills/${sourcePath}`,
                destination: 'skills',
                action: 'move',
              }),
            })
            fetchTreeRef.current()
          } catch { /* ignore */ }
        }
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
            await fetch(`/api/workspaces/${workspaceId}/fs/import`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                sourcePaths,
                destinationFolder: folderPath ? `skills/${folderPath}` : 'skills',
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
  }, [workspaceId, setDragHighlight])

  // Filter tree by search
  const filteredTree = search ? filterTree(tree, search.toLowerCase()) : tree

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between h-11 px-3.5 border-b border-subtle shrink-0">
        <span className="text-[13px] font-semibold text-primary">{t('manage.skills')}</span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowSearch(v => !v)}
            className="text-tertiary hover:text-secondary transition-colors"
            title={t('button.search')}
          >
            <Search size={14} />
          </button>
          <button
            onClick={() => handleCreate(getCreateParent(), 'file')}
            className="text-indigo hover:opacity-80 transition-opacity"
            title={t('button.newFile')}
          >
            <FilePlus size={14} />
          </button>
          <button
            onClick={() => handleCreate(getCreateParent(), 'folder')}
            className="text-indigo hover:opacity-80 transition-opacity"
            title={t('button.newFolder')}
          >
            <FolderPlus size={14} />
          </button>
        </div>
      </div>

      {/* Search */}
      {showSearch && (
        <div className="px-3 py-2">
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-elevated">
            <Search size={13} className="text-muted shrink-0" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('input.searchSkills')}
              className="flex-1 bg-transparent text-[12px] text-primary placeholder:text-muted outline-none"
              autoFocus
            />
          </div>
        </div>
      )}

      {/* File Tree — drag target events are handled via native DOM listeners in useEffect */}
      <div
        ref={treeRef}
        tabIndex={0}
        className={cn(
          'flex-1 overflow-y-auto min-h-0 px-2 py-1 outline-none',
          isDraggingExternal && 'ring-2 ring-indigo/40 ring-inset rounded-md'
        )}
      >
        {/* Inline create input at root level */}
        {creating && creating.parentPath === '' && (
          <SkillInlineCreateInput
            type={creating.type}
            onSubmit={handleCreateSubmit}
            onCancel={() => setCreating(null)}
            depth={0}
          />
        )}
        {filteredTree.length === 0 && !creating && (
          <div
            className="px-3 py-8"
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setContextMenu({ x: e.clientX, y: e.clientY, targetPath: '', targetType: 'root' })
            }}
          >
            <div className="flex flex-col items-center text-center gap-3">
              <span className="text-[12px] text-muted">
                {search ? t('skills.noMatchingSkills') : t('skills.noSkillsYet')}
              </span>
              {!search && (
                <>
                  <button
                    type="button"
                    onClick={() => void handlePaste('')}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-[12px] font-medium text-primary bg-elevated hover:bg-surface-hover transition-colors"
                  >
                    <ClipboardPaste size={12} className="text-tertiary" />
                    <span>{t('contextMenu.paste')}</span>
                  </button>
                  <p className="text-[10px] text-muted">{shortcutLabel}V</p>
                </>
              )}
            </div>
          </div>
        )}
        {filteredTree.map(node => (
          <SkillTreeItem
            key={node.path}
            node={node}
            depth={0}
            selectedPath={selectedNode?.path ?? null}
            clipboardCutPath={clipboardState?.action === 'cut' ? clipboardState.path : null}
            onSelect={(path) => onSelectFile(path)}
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

        {/* Bottom hint */}
        <div className="mt-4 px-2 py-2">
          <p className="text-[10px] text-muted text-center">
            {t('manage.projectSkillsHint')}
          </p>
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed bg-surface border border-subtle rounded-lg shadow-lg z-50 py-1 w-[180px] animate-slide-down"
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
              <button
                onClick={() => { handlePaste(contextMenu.targetPath); setContextMenu(null) }}
                className="flex items-center justify-between w-full px-3 py-1.5 text-[12px] text-primary hover:bg-surface-hover transition-colors"
              >
                <span className="flex items-center gap-2"><ClipboardPaste size={12} className="text-tertiary" /> {t('contextMenu.paste')}</span>
                <span className="text-[10px] text-muted">{shortcutLabel}V</span>
              </button>
              <div className="h-px bg-subtle mx-2 my-1" />
            </>
          )}
          {contextMenu.targetType !== 'root' && (
            <>
              {/* Copy / Cut / Paste */}
              <button
                onClick={() => { handleCopy(contextMenu.targetPath); setContextMenu(null) }}
                className="flex items-center justify-between w-full px-3 py-1.5 text-[12px] text-primary hover:bg-surface-hover transition-colors"
              >
                <span className="flex items-center gap-2"><Copy size={12} className="text-tertiary" /> {t('contextMenu.copy')}</span>
                <span className="text-[10px] text-muted">{shortcutLabel}C</span>
              </button>
              <button
                onClick={() => { handleCut(contextMenu.targetPath); setContextMenu(null) }}
                className="flex items-center justify-between w-full px-3 py-1.5 text-[12px] text-primary hover:bg-surface-hover transition-colors"
              >
                <span className="flex items-center gap-2"><Scissors size={12} className="text-tertiary" /> {t('contextMenu.cut')}</span>
                <span className="text-[10px] text-muted">{shortcutLabel}X</span>
              </button>
              <button
                onClick={() => {
                  const target = contextMenu.targetType === 'folder'
                    ? contextMenu.targetPath
                    : (contextMenu.targetPath.includes('/') ? contextMenu.targetPath.substring(0, contextMenu.targetPath.lastIndexOf('/')) : '')
                  handlePaste(target)
                  setContextMenu(null)
                }}
                className="flex items-center justify-between w-full px-3 py-1.5 text-[12px] text-primary hover:bg-surface-hover transition-colors"
              >
                <span className="flex items-center gap-2"><ClipboardPaste size={12} className="text-tertiary" /> {t('contextMenu.paste')}</span>
                <span className="text-[10px] text-muted">{shortcutLabel}V</span>
              </button>
              <div className="h-px bg-subtle mx-2 my-1" />
              <button
                onClick={() => {
                  const name = contextMenu.targetPath.split('/').pop() || ''
                  setRenaming({ path: contextMenu.targetPath, value: name })
                  setContextMenu(null)
                }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] text-primary hover:bg-surface-hover transition-colors"
              >
                <Pencil size={12} className="text-tertiary" /> {t('common.rename')}
              </button>
              <button
                onClick={() => { handleDelete(contextMenu.targetPath); setContextMenu(null) }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] text-coral hover:bg-surface-hover transition-colors"
              >
                <Trash2 size={12} /> {t('common.delete')}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function SkillTreeItem({
  node, depth, selectedPath, clipboardCutPath, onSelect, onSelectNode, onContextMenu, renaming, onRenameSubmit, onRenameCancel,
  creating, onCreateSubmit, onCreateCancel,
  onDragStart, onDragEnd,
}: {
  node: SkillTreeNode
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
  const [expanded, setExpanded] = useState(false)
  const isFolder = node.type === 'folder'
  const isSelected = selectedPath === node.path
  const isRenaming = renaming?.path === node.path
  const isCut = clipboardCutPath === node.path
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
            {node.isSymlink && (
              <Link size={10} className="text-muted shrink-0 -ml-0.5" />
            )}
          </>
        ) : (
          <>
            <span className="w-3 shrink-0" />
            <FileText size={13} className="text-tertiary shrink-0" />
            {node.isSymlink && (
              <Link size={10} className="text-muted shrink-0 -ml-0.5" />
            )}
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
            {isFolder && node.path && (
              <span className="text-[10px] text-muted ml-1.5 font-normal">
                {node.path}
              </span>
            )}
          </span>
        )}
      </div>
      {isFolder && expanded && node.children && (
        <div>
          {/* Inline create input inside this folder */}
          {creating && creating.parentPath === node.path && (
            <SkillInlineCreateInput
              type={creating.type}
              onSubmit={onCreateSubmit}
              onCancel={onCreateCancel}
              depth={depth + 1}
            />
          )}
          {node.children.map(child => (
            <SkillTreeItem
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

/* ── Inline Create Input for Skills ── */
function SkillInlineCreateInput({
  type,
  onSubmit,
  onCancel,
  depth,
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

/** Recursively filter tree by search term */
function filterTree(nodes: SkillTreeNode[], query: string): SkillTreeNode[] {
  return nodes
    .map(node => {
      if (node.type === 'folder' && node.children) {
        const filteredChildren = filterTree(node.children, query)
        if (filteredChildren.length > 0 || node.name.toLowerCase().includes(query)) {
          return { ...node, children: filteredChildren }
        }
        return null
      }
      return node.name.toLowerCase().includes(query) ? node : null
    })
    .filter((n): n is SkillTreeNode => n !== null)
}

/** Insert optimistic nodes into tree at the given parent path */
function insertSkillNodesIntoTree(tree: SkillTreeNode[], parentPath: string, newNodes: SkillTreeNode[]): SkillTreeNode[] {
  if (!parentPath) {
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
      return { ...node, children: insertSkillNodesIntoTree(node.children, parentPath, newNodes) }
    }
    return node
  })
}
