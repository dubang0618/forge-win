'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  FolderCode,
  FolderOpen,
  Folder,
  FileText,
  MapPin,
  GitBranch,
  Settings,
  PanelRightClose,
  PanelRight,
  ChevronRight,
  FilePlus,
  FolderPlus,
  Home,
  Scissors,
  Copy,
  ClipboardPaste,
  FolderInput,
  Pencil,
  Trash2,
  Link,
  FileSymlink,
  AlertTriangle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useI18n } from '@/components/providers/i18n-provider'
import { GLOBAL_WORKSPACE_ID } from '@/lib/types'

interface RightSidebarProps {
  collapsed: boolean
  onToggleCollapse: () => void
  workspaceId?: string
  workspaceName?: string
  workspacePath?: string
  onOpenFile?: (filename: string) => void
  activeFile?: string | null
  width?: number
}

interface TreeNode {
  name: string
  type: 'file' | 'folder'
  children?: TreeNode[]
}

interface ContextMenuState {
  x: number
  y: number
  targetPath: string
  targetType: 'file' | 'folder'
}

export function RightSidebar({
  collapsed,
  onToggleCollapse,
  workspaceId = '',
  workspaceName = '',
  workspacePath = '',
  onOpenFile,
  activeFile,
  width = 260,
}: RightSidebarProps) {
  const { t } = useI18n()
  const [tree, setTree] = useState<TreeNode[]>([])
  const [loading, setLoading] = useState(false)
  const [folderMissing, setFolderMissing] = useState(false)

  // Selection: tracks the currently selected item (file or folder)
  const [selected, setSelected] = useState<{ path: string; type: 'file' | 'folder' } | null>(null)

  // Context menu
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [renaming, setRenaming] = useState<{ path: string; value: string } | null>(null)
  const [creating, setCreating] = useState<{ parentPath: string; type: 'file' | 'folder' } | null>(null)
  const [projectExpanded, setProjectExpanded] = useState(true)

  // Clipboard & drag state
  const [clipboardState, setClipboardState] = useState<{ action: 'copy' | 'cut'; path: string } | null>(null)
  const dragOverPathRef = useRef<string | null>(null)
  const [isDraggingExternal, setIsDraggingExternal] = useState(false)
  const treeRef = useRef<HTMLDivElement>(null)

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

  const isGlobalMode = false // Global main agent removed — always project mode

  // ── Path helpers ──

  // activeFile is now stored as the full tree path (including .claude/ prefix),
  // so no conversion is needed for highlight matching.
  const activeTreePath = activeFile || null

  // ── Data fetching ──

  const fetchTree = useCallback(async () => {
    if (!workspaceId) { setTree([]); setFolderMissing(false); return }
    // Only show loading spinner on initial load (when tree is empty)
    const isInitial = tree.length === 0
    if (isInitial) setLoading(true)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/tree`)
      const data = await res.json()
      setTree(data.tree || [])
      setFolderMissing(data.folderMissing === true)
    } catch { /* ignore */ }
    if (isInitial) setLoading(false)
  }, [workspaceId, tree.length])

  useEffect(() => {
    fetchTree()
  }, [fetchTree])

  // ── File system watcher: listen for external changes via Electron IPC ──
  useEffect(() => {
    const api = (window as unknown as { electronAPI?: {
      watchDirectory?: (dirPath: string) => void
      onFsChanged?: (cb: () => void) => (() => void)
      homeForgePath?: string
    } }).electronAPI
    if (!api?.watchDirectory || !api?.onFsChanged) return

    const watchPath = isGlobalMode ? (api.homeForgePath || '') : workspacePath
    if (!watchPath) return

    api.watchDirectory(watchPath)

    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    const cleanup = api.onFsChanged(() => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => fetchTree(), 300)
    })

    return () => {
      cleanup?.()
      if (debounceTimer) clearTimeout(debounceTimer)
    }
  }, [workspacePath, isGlobalMode, fetchTree])

  // ── Agent file change listener: refresh tree when agent creates/edits files ──
  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    const handler = () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => fetchTree(), 500)
    }
    window.addEventListener('forge:files-changed', handler)
    return () => {
      window.removeEventListener('forge:files-changed', handler)
      if (debounceTimer) clearTimeout(debounceTimer)
    }
  }, [fetchTree])

  // Close context menu on click anywhere
  useEffect(() => {
    if (!contextMenu) return
    const handler = () => setContextMenu(null)
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [contextMenu])

  // ── Selection ──

  const handleSelect = useCallback((path: string, type: 'file' | 'folder') => {
    setSelected({ path, type })
  }, [])

  // Determine create parent based on current selection (no .claude restriction)
  const getCreateParent = useCallback((): string => {
    if (!selected) return ''
    if (selected.type === 'folder') return selected.path
    // File: use parent directory
    const lastSlash = selected.path.lastIndexOf('/')
    return lastSlash >= 0 ? selected.path.substring(0, lastSlash) : ''
  }, [selected])

  // Determine API scope based on mode
  const apiScope = isGlobalMode ? 'forge' : 'project'

  // ── File operations ──

  const handleCreateFile = useCallback((parentPath: string) => {
    setCreating({ parentPath, type: 'file' })
  }, [])

  const handleCreateFolder = useCallback((parentPath: string) => {
    setCreating({ parentPath, type: 'folder' })
  }, [])

  const handleCreateSubmit = useCallback(async (name: string) => {
    if (!creating || !name.trim()) { setCreating(null); return }
    const parentPath = creating.parentPath
    const relPath = parentPath ? `${parentPath}/${name.trim()}` : name.trim()
    try {
      await fetch(`/api/workspaces/${workspaceId}/fs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: relPath,
          type: creating.type,
          scope: apiScope,
          ...(creating.type === 'file' ? { content: '' } : {}),
        }),
      })
      fetchTree()
    } catch { /* ignore */ }
    setCreating(null)
  }, [creating, workspaceId, fetchTree, apiScope])

  const handleRename = useCallback(async (fullPath: string, newName: string) => {
    const dir = fullPath.includes('/') ? fullPath.substring(0, fullPath.lastIndexOf('/')) : ''
    const newPath = dir ? `${dir}/${newName}` : newName
    if (newPath === fullPath) { setRenaming(null); return }
    try {
      await fetch(`/api/workspaces/${workspaceId}/fs`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPath: fullPath, newPath, scope: apiScope }),
      })
      fetchTree()
    } catch { /* ignore */ }
    setRenaming(null)
  }, [workspaceId, fetchTree, apiScope])

  const handleDelete = useCallback(async (fullPath: string) => {
    try {
      console.log('[RightSidebar] Deleting:', { fullPath, workspaceId, apiScope })
      const res = await fetch(`/api/workspaces/${workspaceId}/fs?path=${encodeURIComponent(fullPath)}&scope=${apiScope}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const error = await res.text()
        console.error('[RightSidebar] Delete failed:', error)
        return
      }
      console.log('[RightSidebar] Delete successful:', fullPath)
      // Add a small delay before refreshing to ensure file system operations complete
      // and to avoid race conditions with the file watcher
      await new Promise(resolve => setTimeout(resolve, 100))
      fetchTree()
    } catch (err) {
      console.error('[RightSidebar] Delete error:', err)
    }
  }, [workspaceId, fetchTree, apiScope])

  const handleContextMenu = useCallback((e: React.MouseEvent, targetPath: string, targetType: 'file' | 'folder') => {
    e.preventDefault()
    e.stopPropagation()
    // Clamp position to keep menu within viewport
    const menuW = 200, menuH = 340
    const x = Math.min(e.clientX, window.innerWidth - menuW - 8)
    const y = Math.min(e.clientY, window.innerHeight - menuH - 8)
    setContextMenu({ x, y, targetPath, targetType })
  }, [])

  // ── Clipboard operations ──

  const handleCopy = useCallback((path: string) => {
    setClipboardState({ action: 'copy', path })
  }, [])

  const handleCut = useCallback((path: string) => {
    setClipboardState({ action: 'cut', path })
  }, [])

  /* ── Optimistic tree helpers ── */

  const addOptimisticNodes = useCallback((targetFolder: string, names: string[]) => {
    const newNodes: TreeNode[] = names.map(name => ({ name, type: 'folder' as const }))
    setTree(prev => insertSidebarNodesIntoTree(prev, targetFolder, newNodes))
  }, [])

  const shortcutLabel = window.electronAPI?.platform === 'darwin' ? '⌘' : 'Ctrl+'

  const handlePaste = useCallback(async (targetFolder: string) => {
    if (!workspaceId) return

    // Internal clipboard paste
    if (clipboardState) {
      const action = clipboardState.action === 'cut' ? 'move' : 'copy'
      try {
        await fetch(`/api/workspaces/${workspaceId}/fs`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: clipboardState.path, destination: targetFolder, action }),
        })
        if (clipboardState.action === 'cut') setClipboardState(null)
        fetchTree()
      } catch { /* ignore */ }
      return
    }

    // OS clipboard paste
    const api = window.electronAPI
    if (api?.readClipboardFiles) {
      try {
        const files = await api.readClipboardFiles()
        if (files.length > 0) {
          // Optimistic: add placeholder nodes immediately
          const names = files.map(f => f.split('/').pop()!).filter(Boolean)
          if (names.length > 0) addOptimisticNodes(targetFolder, names)

          const res = await fetch(`/api/workspaces/${workspaceId}/fs/import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sourcePaths: files, destinationFolder: targetFolder || '.' }),
          })
          fetchTree() // always refresh to get real state
          if (!res.ok) console.warn('Import failed:', await res.text())
        }
      } catch {
        fetchTree() // revert optimistic on error
      }
    }
  }, [clipboardState, workspaceId, fetchTree, addOptimisticNodes])

  const handleCopyPath = useCallback((relPath: string) => {
    const absPath = workspacePath ? `${workspacePath}/${relPath}` : relPath
    const api = window.electronAPI
    if (api?.copyToClipboard) {
      api.copyToClipboard(absPath)
    } else {
      navigator.clipboard.writeText(absPath)
    }
  }, [workspacePath])

  const handleCopyRelativePath = useCallback((relPath: string) => {
    const api = window.electronAPI
    if (api?.copyToClipboard) {
      api.copyToClipboard(relPath)
    } else {
      navigator.clipboard.writeText(relPath)
    }
  }, [])

  const handleShowInFolder = useCallback((relPath: string) => {
    const absPath = workspacePath ? `${workspacePath}/${relPath}` : relPath
    window.electronAPI?.showInFolder(absPath)
  }, [workspacePath])

  // ── Drag & drop: internal move ──

  const handleDragStart = useCallback((e: React.DragEvent, path: string) => {
    e.dataTransfer.setData('forge/tree-path', path)
    e.dataTransfer.effectAllowed = 'move'
  }, [])

  const handleDragOverFolder = useCallback((e: React.DragEvent, folderPath: string) => {
    e.preventDefault()
    e.stopPropagation()
    // Accept both internal tree drags and external file drops
    e.dataTransfer.dropEffect = e.dataTransfer.types.includes('forge/tree-path') ? 'move' : 'copy'
    setDragHighlight(folderPath)
  }, [])

  const handleDropOnFolder = useCallback(async (e: React.DragEvent, folderPath: string) => {
    e.preventDefault()
    e.stopPropagation()
    setDragHighlight(null)
    setIsDraggingExternal(false)

    // Internal tree drag (move)
    const sourcePath = e.dataTransfer.getData('forge/tree-path')
    if (sourcePath && workspaceId) {
      // Prevent dropping onto itself or into own children
      if (sourcePath === folderPath || folderPath.startsWith(sourcePath + '/')) return
      try {
        await fetch(`/api/workspaces/${workspaceId}/fs`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: sourcePath, destination: folderPath, action: 'move' }),
        })
        fetchTree()
      } catch { /* ignore */ }
      return
    }

    // External file drop from OS
    const files = e.dataTransfer.files
    if (files.length > 0 && workspaceId) {
      const sourcePaths: string[] = []
      for (let i = 0; i < files.length; i++) {
        const file = files[i] as File & { path?: string }
        if (file.path) sourcePaths.push(file.path)
      }
      if (sourcePaths.length > 0) {
        // Optimistic: add placeholder nodes immediately
        const names = sourcePaths.map(p => p.split('/').pop()!).filter(Boolean)
        if (names.length > 0) addOptimisticNodes(folderPath, names)

        try {
          await fetch(`/api/workspaces/${workspaceId}/fs/import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sourcePaths, destinationFolder: folderPath || '.' }),
          })
        } catch { /* ignore */ }
        fetchTree() // always refresh to get real state
      }
    }
  }, [workspaceId, fetchTree, addOptimisticNodes])

  const handleDragEnd = useCallback(() => {
    setDragHighlight(null)
    setIsDraggingExternal(false)
  }, [])

  // ── File drop on tree container (root-level target for both internal & external) ──

  const handleTreeDragOver = useCallback((e: React.DragEvent) => {
    const isInternal = e.dataTransfer.types.includes('forge/tree-path')
    const isExternal = e.dataTransfer.types.includes('Files')
    if (!isInternal && !isExternal) return
    e.preventDefault()
    e.dataTransfer.dropEffect = isInternal ? 'move' : 'copy'
    if (isExternal) setIsDraggingExternal(true)
  }, [])

  const handleTreeDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    setDragHighlight(null)
    setIsDraggingExternal(false)

    if (!workspaceId) return

    // Internal tree drag → move to root
    const internalPath = e.dataTransfer.getData('forge/tree-path')
    if (internalPath) {
      if (!internalPath.includes('/')) return // already at root level
      try {
        await fetch(`/api/workspaces/${workspaceId}/fs`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: internalPath, destination: '.', action: 'move' }),
        })
        fetchTree()
      } catch { /* ignore */ }
      return
    }

    // External file drop → import to root
    const files = e.dataTransfer.files
    if (files.length > 0) {
      const sourcePaths: string[] = []
      for (let i = 0; i < files.length; i++) {
        const file = files[i] as File & { path?: string }
        if (file.path) sourcePaths.push(file.path)
      }
      if (sourcePaths.length > 0) {
        // Optimistic: add placeholder nodes immediately
        const names = sourcePaths.map(p => p.split('/').pop()!).filter(Boolean)
        if (names.length > 0) addOptimisticNodes('.', names)

        try {
          await fetch(`/api/workspaces/${workspaceId}/fs/import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sourcePaths, destinationFolder: '.' }),
          })
        } catch { /* ignore */ }
        fetchTree() // always refresh to get real state
      }
    }
  }, [workspaceId, fetchTree, addOptimisticNodes])

  const handleTreeDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear if leaving the tree container entirely
    if (treeRef.current && !treeRef.current.contains(e.relatedTarget as Node)) {
      setIsDraggingExternal(false)
    }
  }, [])

  // ── Keyboard shortcuts ──

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't intercept if focused in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      // ⌘V paste: works even without selection (paste to root)
      const isMod = e.metaKey || e.ctrlKey
      if (isMod && e.key === 'v') {
        e.preventDefault()
        const targetFolder = !selected ? '.'
          : selected.type === 'folder' ? selected.path
          : (selected.path.includes('/') ? selected.path.substring(0, selected.path.lastIndexOf('/')) : '.')
        handlePaste(targetFolder)
        return
      }

      // Other shortcuts require a selection
      if (!selected) return

      // F2: rename (no modifier needed)
      if (e.key === 'F2') {
        e.preventDefault()
        const name = selected.path.split('/').pop() || ''
        setRenaming({ path: selected.path, value: name })
        return
      }

      if (!isMod) return
      if (e.key === 'c' && !e.shiftKey) {
        e.preventDefault()
        handleCopy(selected.path)
      } else if (e.key === 'x') {
        e.preventDefault()
        handleCut(selected.path)
      }
    }
    const el = treeRef.current
    if (el) {
      el.addEventListener('keydown', handler)
      return () => el.removeEventListener('keydown', handler)
    }
  }, [selected, handleCopy, handleCut, handlePaste])

  // Handle file open: pass full tree path (including .claude/ prefix) to editor
  const handleFileOpen = useCallback((fullPath: string) => {
    onOpenFile?.(fullPath)
  }, [onOpenFile])

  const shortPath = workspacePath
    ? workspacePath.replace(/^\/Users\/[^/]+/, '~')
    : ''

  return (
    <div
      className="flex flex-col bg-surface border-l border-subtle shrink-0 overflow-hidden relative sidebar-transition"
      style={{ width: collapsed ? 36 : width }}
    >
      {/* Collapsed state */}
      <div
        className={cn(
          'absolute inset-0 flex flex-col items-center py-3 transition-opacity duration-200',
          collapsed ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
      >
        <button
          onClick={onToggleCollapse}
          className="p-1.5 rounded-md hover:bg-surface-hover transition-colors"
          title={t('button.expandSidebar')}
        >
          <PanelRight size={16} className="text-tertiary" />
        </button>
      </div>

      {/* Expanded content */}
      <div
        className={cn(
          'flex flex-col h-full transition-opacity duration-200',
          collapsed ? 'opacity-0 pointer-events-none' : 'opacity-100'
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between h-[52px] px-4 shrink-0">
          <span className="text-[13px] font-semibold text-primary truncate">{t('sidebar.files')}</span>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => handleCreateFile(getCreateParent())}
              className="p-1.5 rounded-md hover:bg-surface-hover transition-colors"
              title={t('button.newFile')}
            >
              <FilePlus size={14} className="text-tertiary" />
            </button>
            <button
              onClick={() => handleCreateFolder(getCreateParent())}
              className="p-1.5 rounded-md hover:bg-surface-hover transition-colors"
              title={t('button.newFolder')}
            >
              <FolderPlus size={14} className="text-tertiary" />
            </button>
            <button
              onClick={onToggleCollapse}
              className="p-1.5 rounded-md hover:bg-surface-hover transition-colors"
              title={t('button.collapseSidebar')}
            >
              <PanelRightClose size={16} className="text-tertiary" />
            </button>
          </div>
        </div>

        {/* Project Info (compact) */}
        <div className="px-4 py-2 border-b border-subtle shrink-0">
          <div className="flex items-center gap-1.5 mb-1">
            {isGlobalMode ? (
              <Home size={14} className="text-indigo shrink-0" />
            ) : (
              <FolderCode size={14} className="text-indigo shrink-0" />
            )}
            <span className="text-[12px] font-semibold text-primary truncate">
              {isGlobalMode ? 'Main Agent' : workspaceName || 'No project'}
            </span>
          </div>
          {!isGlobalMode && shortPath && (
            <div className="flex items-center gap-1.5 mb-1">
              <MapPin size={12} className="text-tertiary shrink-0" />
              <span className="text-[11px] text-secondary truncate">{shortPath}</span>
            </div>
          )}
          {isGlobalMode && (
            <div className="flex items-center gap-1.5 mb-1">
              <MapPin size={12} className="text-tertiary shrink-0" />
              <span className="text-[11px] text-secondary truncate">~/.claude/</span>
            </div>
          )}
          {!isGlobalMode && (
            <div className="flex items-center gap-1.5">
              <GitBranch size={12} className="text-green shrink-0" />
              <span className="text-[11px] text-green">main</span>
            </div>
          )}
        </div>

        {/* ── Unified File Tree ── */}
        <div
          ref={treeRef}
          tabIndex={0}
          className={cn(
            'flex-1 overflow-y-auto min-h-0 px-2 py-2 outline-none',
            isDraggingExternal && 'ring-2 ring-indigo/40 ring-inset rounded-md'
          )}
          onClick={(e) => { if (e.target === e.currentTarget) setSelected(null) }}
          onDragOver={handleTreeDragOver}
          onDrop={handleTreeDrop}
          onDragLeave={handleTreeDragLeave}
        >
          {folderMissing && !isGlobalMode ? (
            /* Project folder was deleted from disk */
            <div className="flex flex-col items-center justify-center gap-3 py-8 px-4 text-center">
              <AlertTriangle size={24} className="text-amber" />
              <div>
                <p className="text-[12px] font-medium text-primary mb-1">{t('error.folderNotFound')}</p>
                <p className="text-[11px] text-muted leading-relaxed">
                  {t('error.folderNotFoundDesc')}
                </p>
              </div>
            </div>
          ) : isGlobalMode ? (
            /* Global mode: show ~/.claude/ contents directly */
            <>
              {creating && creating.parentPath === '' && (
                <InlineCreateInput
                  type={creating.type}
                  onSubmit={handleCreateSubmit}
                  onCancel={() => setCreating(null)}
                  depth={0}
                />
              )}
              {loading && <p className="text-[11px] text-muted py-2 px-2">{t('status.loading')}</p>}
              {tree.map(node => (
                <UnifiedTreeNode
                  key={node.name}
                  node={node}
                  depth={0}
                  basePath=""
                  selectedPath={selected?.path ?? null}
                  onSelect={handleSelect}
                  activeTreePath={activeTreePath}
                  onOpenFile={handleFileOpen}
                  onContextMenu={handleContextMenu}
                  renaming={renaming}
                  onRenameSubmit={handleRename}
                  onRenameCancel={() => setRenaming(null)}
                  creating={creating}
                  onCreateSubmit={handleCreateSubmit}
                  onCreateCancel={() => setCreating(null)}
                  isGlobalMode={isGlobalMode}
                  clipboardCutPath={clipboardState?.action === 'cut' ? clipboardState.path : null}
                  onDragStart={handleDragStart}
                  onDragOverFolder={handleDragOverFolder}
                  onDropOnFolder={handleDropOnFolder}
                  onDragEnd={handleDragEnd}
                />
              ))}
            </>
          ) : (
            /* Project mode: project folder name as root node */
            <div>
              <button
                data-drop-path="."
                onClick={() => setProjectExpanded(!projectExpanded)}
                onDragOver={(e) => handleDragOverFolder(e, '.')}
                onDrop={(e) => handleDropOnFolder(e, '.')}
                className="flex items-center gap-1 w-full h-[26px] px-1.5 rounded hover:bg-surface-hover transition-colors text-left"
              >
                <ChevronRight size={12} className={cn('text-tertiary shrink-0 chevron-transition', projectExpanded && 'rotate-90')} />
                <FolderCode size={13} className="text-indigo shrink-0" />
                <span className="text-[11px] text-primary font-semibold truncate">
                  {workspaceName || 'project'}
                </span>
              </button>
              {projectExpanded && (
                <div>
                  {creating && creating.parentPath === '' && (
                    <InlineCreateInput
                      type={creating.type}
                      onSubmit={handleCreateSubmit}
                      onCancel={() => setCreating(null)}
                      depth={1}
                    />
                  )}
                  {loading && (
                    <p className="text-[11px] text-muted py-2" style={{ paddingLeft: '20px' }}>{t('status.loading')}</p>
                  )}
                  {tree.map(node => (
                    <UnifiedTreeNode
                      key={node.name}
                      node={node}
                      depth={1}
                      basePath=""
                      selectedPath={selected?.path ?? null}
                      onSelect={handleSelect}
                      activeTreePath={activeTreePath}
                      onOpenFile={handleFileOpen}
                      onContextMenu={handleContextMenu}
                      renaming={renaming}
                      onRenameSubmit={handleRename}
                      onRenameCancel={() => setRenaming(null)}
                      creating={creating}
                      onCreateSubmit={handleCreateSubmit}
                      onCreateCancel={() => setCreating(null)}
                      isGlobalMode={isGlobalMode}
                      clipboardCutPath={clipboardState?.action === 'cut' ? clipboardState.path : null}
                      onDragStart={handleDragStart}
                      onDragOverFolder={handleDragOverFolder}
                      onDropOnFolder={handleDropOnFolder}
                      onDragEnd={handleDragEnd}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed bg-surface border border-subtle rounded-lg shadow-lg z-50 py-1 w-[200px] animate-slide-down"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.targetType === 'folder' && (
            <>
              <button
                onClick={() => { handleCreateFile(contextMenu.targetPath); setContextMenu(null) }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] text-primary hover:bg-surface-hover transition-colors"
              >
                <FilePlus size={12} className="text-tertiary" /> {t('button.newFile')}
              </button>
              <button
                onClick={() => { handleCreateFolder(contextMenu.targetPath); setContextMenu(null) }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] text-primary hover:bg-surface-hover transition-colors"
              >
                <FolderPlus size={12} className="text-tertiary" /> {t('button.newFolder')}
              </button>
              <div className="h-px bg-subtle mx-2 my-1" />
            </>
          )}
          {/* Copy / Cut / Paste */}
          <button
            onClick={() => { handleCopy(contextMenu.targetPath); setContextMenu(null) }}
            className="flex items-center justify-between w-full px-3 py-1.5 text-[12px] text-primary hover:bg-surface-hover transition-colors"
          >
            <span className="flex items-center gap-2"><Copy size={12} className="text-tertiary" /> Copy</span>
            <span className="text-[10px] text-muted">{shortcutLabel}C</span>
          </button>
          <button
            onClick={() => { handleCut(contextMenu.targetPath); setContextMenu(null) }}
            className="flex items-center justify-between w-full px-3 py-1.5 text-[12px] text-primary hover:bg-surface-hover transition-colors"
          >
            <span className="flex items-center gap-2"><Scissors size={12} className="text-tertiary" /> Cut</span>
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
            disabled={!clipboardState}
            className="flex items-center justify-between w-full px-3 py-1.5 text-[12px] text-primary hover:bg-surface-hover transition-colors disabled:opacity-40"
          >
            <span className="flex items-center gap-2"><ClipboardPaste size={12} className="text-tertiary" /> Paste</span>
            <span className="text-[10px] text-muted">{shortcutLabel}V</span>
          </button>
          <div className="h-px bg-subtle mx-2 my-1" />
          {/* Rename / Delete */}
          <button
            onClick={() => {
              const name = contextMenu.targetPath.split('/').pop() || ''
              setRenaming({ path: contextMenu.targetPath, value: name })
              setContextMenu(null)
            }}
            className="flex items-center justify-between w-full px-3 py-1.5 text-[12px] text-primary hover:bg-surface-hover transition-colors"
          >
            <span className="flex items-center gap-2"><Pencil size={12} className="text-tertiary" /> {t('common.rename')}</span>
            <span className="text-[10px] text-muted">F2</span>
          </button>
          <button
            onClick={() => { handleDelete(contextMenu.targetPath); setContextMenu(null) }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] text-coral hover:bg-surface-hover transition-colors"
          >
            <Trash2 size={12} /> {t('common.delete')}
          </button>
          <div className="h-px bg-subtle mx-2 my-1" />
          {/* Path operations */}
          <button
            onClick={() => { handleCopyPath(contextMenu.targetPath); setContextMenu(null) }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] text-primary hover:bg-surface-hover transition-colors"
          >
            <Link size={12} className="text-tertiary" /> Copy Path
          </button>
          <button
            onClick={() => { handleCopyRelativePath(contextMenu.targetPath); setContextMenu(null) }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] text-primary hover:bg-surface-hover transition-colors"
          >
            <FileSymlink size={12} className="text-tertiary" /> Copy Relative Path
          </button>
          {!isGlobalMode && (
            <button
              onClick={() => { handleShowInFolder(contextMenu.targetPath); setContextMenu(null) }}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] text-primary hover:bg-surface-hover transition-colors"
            >
              <FolderInput size={12} className="text-tertiary" /> {window.electronAPI?.platform === 'darwin' ? 'Reveal in Finder' : 'Show in Folder'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/* ── Unified Tree Node (recursive, handles all file types) ── */
function UnifiedTreeNode({
  node, depth, basePath, selectedPath, onSelect, activeTreePath, onOpenFile,
  onContextMenu, renaming, onRenameSubmit, onRenameCancel,
  creating, onCreateSubmit, onCreateCancel, isGlobalMode,
  clipboardCutPath,
  onDragStart, onDragOverFolder, onDropOnFolder, onDragEnd,
}: {
  node: TreeNode
  depth: number
  basePath: string
  selectedPath: string | null
  onSelect: (path: string, type: 'file' | 'folder') => void
  activeTreePath: string | null
  onOpenFile: (fullPath: string) => void
  onContextMenu: (e: React.MouseEvent, path: string, type: 'file' | 'folder') => void
  renaming: { path: string; value: string } | null
  onRenameSubmit: (fullPath: string, newName: string) => void
  onRenameCancel: () => void
  creating: { parentPath: string; type: 'file' | 'folder' } | null
  onCreateSubmit: (name: string) => void
  onCreateCancel: () => void
  isGlobalMode: boolean
  clipboardCutPath: string | null
  onDragStart: (e: React.DragEvent, path: string) => void
  onDragOverFolder: (e: React.DragEvent, folderPath: string) => void
  onDropOnFolder: (e: React.DragEvent, folderPath: string) => void
  onDragEnd: () => void
}) {
  const fullPath = basePath ? `${basePath}/${node.name}` : node.name
  const isFolder = node.type === 'folder'
  const isClaudeRoot = node.name === '.claude' && !basePath
  const [expanded, setExpanded] = useState(isClaudeRoot || depth < 1)
  const isSelected = selectedPath === fullPath
  const isActive = !isFolder && activeTreePath === fullPath
  const isRenaming = renaming?.path === fullPath
  const isInClaude = isGlobalMode || fullPath === '.claude' || fullPath.startsWith('.claude/')
  const isCut = clipboardCutPath === fullPath
  const wasDragged = useRef(false)

  const handleClick = () => {
    if (wasDragged.current) return // suppress click after drag
    if (isFolder) {
      setExpanded(!expanded)
      onSelect(fullPath, 'folder')
    } else {
      onSelect(fullPath, 'file')
      onOpenFile(fullPath)
    }
  }

  // Determine icon
  const renderIcon = () => {
    if (isClaudeRoot) {
      return <Settings size={13} className="text-amber shrink-0" />
    }
    if (isFolder) {
      return expanded
        ? <FolderOpen size={13} className="text-amber shrink-0" />
        : <Folder size={13} className="text-amber shrink-0" />
    }
    // Files: .md files inside .claude get indigo color
    const isForgeFile = isInClaude && node.name.endsWith('.md')
    return <FileText size={13} className={cn(isForgeFile ? 'text-indigo' : 'text-tertiary', 'shrink-0')} />
  }

  return (
    <div>
      <div
        draggable={!isRenaming}
        onClick={handleClick}
        onContextMenu={(e) => onContextMenu(e, fullPath, isFolder ? 'folder' : 'file')}
        onDragStart={(e) => { wasDragged.current = true; onDragStart(e, fullPath) }}
        onDragEnd={() => { setTimeout(() => { wasDragged.current = false }, 100); onDragEnd() }}
        {...(isFolder ? {
          'data-drop-path': fullPath,
          onDragOver: (e: React.DragEvent) => onDragOverFolder(e, fullPath),
          onDrop: (e: React.DragEvent) => onDropOnFolder(e, fullPath),
          onDragLeave: () => {/* highlight cleared by setDragHighlight */},
        } : {})}
        className={cn(
          'flex items-center gap-1 w-full h-[26px] px-1.5 rounded cursor-pointer transition-colors',
          isSelected ? 'bg-surface-active' : isActive ? 'bg-elevated' : 'hover:bg-surface-hover',
          isCut && 'opacity-50'
        )}
        style={{ paddingLeft: `${depth * 16}px` }}
      >
        {isFolder ? (
          <ChevronRight size={12} className={cn('text-tertiary shrink-0 chevron-transition', expanded && 'rotate-90')} />
        ) : (
          <span className="w-3 shrink-0" />
        )}
        {renderIcon()}
        {isRenaming ? (
          <input
            autoFocus
            defaultValue={renaming.value}
            className="text-[11px] text-primary bg-transparent outline-none border-b border-indigo flex-1"
            onBlur={(e) => onRenameSubmit(fullPath, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onRenameSubmit(fullPath, e.currentTarget.value)
              if (e.key === 'Escape') onRenameCancel()
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className={cn(
            'text-[11px] truncate',
            isFolder ? 'text-primary font-medium' : isActive ? 'text-primary font-semibold' : 'text-secondary'
          )}>
            {node.name}
          </span>
        )}
      </div>
      {isFolder && expanded && (
        <div>
          {/* Inline create input inside this folder */}
          {creating && creating.parentPath === fullPath && (
            <InlineCreateInput
              type={creating.type}
              onSubmit={onCreateSubmit}
              onCancel={onCreateCancel}
              depth={depth + 1}
            />
          )}
          {node.children?.map(child => (
            <UnifiedTreeNode
              key={child.name}
              node={child}
              depth={depth + 1}
              basePath={fullPath}
              selectedPath={selectedPath}
              onSelect={onSelect}
              activeTreePath={activeTreePath}
              onOpenFile={onOpenFile}
              onContextMenu={onContextMenu}
              renaming={renaming}
              onRenameSubmit={onRenameSubmit}
              onRenameCancel={onRenameCancel}
              creating={creating}
              onCreateSubmit={onCreateSubmit}
              onCreateCancel={onCreateCancel}
              isGlobalMode={isGlobalMode}
              clipboardCutPath={clipboardCutPath}
              onDragStart={onDragStart}
              onDragOverFolder={onDragOverFolder}
              onDropOnFolder={onDropOnFolder}
              onDragEnd={onDragEnd}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Inline Create Input (VS Code style) ── */
function InlineCreateInput({
  type,
  onSubmit,
  onCancel,
  depth = 0,
}: {
  type: 'file' | 'folder'
  onSubmit: (name: string) => void
  onCancel: () => void
  depth?: number
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
      className="flex items-center gap-1.5 h-[26px] px-1.5 rounded"
      style={{ paddingLeft: `${depth * 16}px` }}
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

/* ── Optimistic tree insertion helper for sidebar (TreeNode has no path property) ── */

function insertSidebarNodesIntoTree(tree: TreeNode[], targetFolder: string, newNodes: TreeNode[]): TreeNode[] {
  // Root-level insert ('.' or '')
  if (!targetFolder || targetFolder === '.' || targetFolder === '') {
    const existingNames = new Set(tree.map(n => n.name))
    const unique = newNodes.filter(n => !existingNames.has(n.name))
    return [...tree, ...unique]
  }

  const segments = targetFolder.split('/')
  return insertAtPath(tree, segments, 0, newNodes)
}

function insertAtPath(nodes: TreeNode[], segments: string[], idx: number, newNodes: TreeNode[]): TreeNode[] {
  return nodes.map(node => {
    if (node.name === segments[idx] && node.type === 'folder') {
      if (idx === segments.length - 1) {
        // This is the target folder
        const existingNames = new Set((node.children || []).map(n => n.name))
        const unique = newNodes.filter(n => !existingNames.has(n.name))
        return { ...node, children: [...(node.children || []), ...unique] }
      }
      // Recurse deeper
      return { ...node, children: insertAtPath(node.children || [], segments, idx + 1, newNodes) }
    }
    return node
  })
}
