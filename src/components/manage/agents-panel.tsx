'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Search, FilePlus, ChevronRight, ChevronDown,
  FileText, Pencil, Trash2, ClipboardPaste,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useI18n } from '@/components/providers/i18n-provider'
import { GLOBAL_WORKSPACE_ID } from '@/lib/types'
import type { AgentSelection } from '@/hooks/use-agent-config'

interface AgentFileNode {
  name: string
  type: 'file' | 'folder'
  path: string
  model?: string
}

interface ContextMenuState {
  x: number
  y: number
  targetPath: string
  targetSection: 'config' | 'subagent'
  targetType?: 'root' | 'file'
}

interface AgentsPanelProps {
  configFiles: string[]
  selection: AgentSelection | null
  onSelect: (sel: AgentSelection) => void
  onCreateConfigFile: (name: string) => void
  onDeleteConfigFile: (filename: string) => void
  onRenameConfigFile: (oldName: string, newName: string) => void
}

export function AgentsPanel({
  configFiles,
  selection,
  onSelect,
  onCreateConfigFile,
  onDeleteConfigFile,
  onRenameConfigFile,
}: AgentsPanelProps) {
  const { t } = useI18n()
  const [search, setSearch] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const [subAgentsExpanded, setSubAgentsExpanded] = useState(true)
  const [agentFiles, setAgentFiles] = useState<AgentFileNode[]>([])
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [renaming, setRenaming] = useState<{ path: string; section: 'config' | 'subagent'; value: string } | null>(null)
  const [creatingConfig, setCreatingConfig] = useState(false)
  const [creatingAgent, setCreatingAgent] = useState(false)
  const [isDraggingExternal, setIsDraggingExternal] = useState(false)
  const shortcutLabel = window.electronAPI?.platform === 'darwin' ? '⌘' : 'Ctrl+'
  const subAgentsRef = useRef<HTMLDivElement>(null)

  const workspaceId = GLOBAL_WORKSPACE_ID

  // Fetch agent files (flat list of .md files from agents/)
  const fetchAgentFiles = useCallback(async () => {
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/agents-tree`)
      const data = await res.json()
      // Flatten: only take top-level .md files (no folders)
      const files = (data.tree || []).filter((n: AgentFileNode) => n.type === 'file')
      setAgentFiles(files)
    } catch {
      setAgentFiles([])
    }
  }, [workspaceId])

  useEffect(() => { fetchAgentFiles() }, [fetchAgentFiles])

  // Close context menu on click
  useEffect(() => {
    if (!contextMenu) return
    const handler = () => setContextMenu(null)
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [contextMenu])

  // Create a new agent .md file
  const handleCreateAgentSubmit = useCallback(async (name: string) => {
    if (!name.trim()) { setCreatingAgent(false); return }
    const filename = name.trim().endsWith('.md') ? name.trim() : `${name.trim()}.md`
    try {
      await fetch(`/api/workspaces/${workspaceId}/fs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: `agents/${filename}`,
          type: 'file',
          content: '---\nname: New Agent\ndescription: \nmodel: inherit\nenabled: true\n---\n\n# Agent Instructions\n\n',
        }),
      })
      fetchAgentFiles()
    } catch { /* ignore */ }
    setCreatingAgent(false)
  }, [workspaceId, fetchAgentFiles])

  // Rename an agent file
  const handleRenameAgent = useCallback(async (oldPath: string, newName: string) => {
    if (!newName.trim() || newName.trim() === oldPath) { setRenaming(null); return }
    try {
      await fetch(`/api/workspaces/${workspaceId}/fs`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPath: `agents/${oldPath}`, newPath: `agents/${newName.trim()}` }),
      })
      fetchAgentFiles()
    } catch { /* ignore */ }
    setRenaming(null)
  }, [workspaceId, fetchAgentFiles])

  // Delete an agent file
  const handleDeleteAgent = useCallback(async (relPath: string) => {
    try {
      console.log('[AgentsPanel] Deleting:', { relPath, workspaceId })
      const res = await fetch(`/api/workspaces/${workspaceId}/fs?path=${encodeURIComponent(`agents/${relPath}`)}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const error = await res.text()
        console.error('[AgentsPanel] Delete failed:', error)
        return
      }
      console.log('[AgentsPanel] Delete successful, refreshing tree')
      // Add delay to avoid race conditions with file watcher
      await new Promise(resolve => setTimeout(resolve, 100))
      await fetchAgentFiles()
      console.log('[AgentsPanel] Tree refreshed')
    } catch (err) {
      console.error('[AgentsPanel] Delete error:', err)
    }
  }, [workspaceId, fetchAgentFiles])

  // Rename a config file
  const handleRenameConfig = useCallback(async (oldName: string, newName: string) => {
    if (!newName.trim()) { setRenaming(null); return }
    const finalName = newName.trim().endsWith('.md') ? newName.trim() : `${newName.trim()}.md`
    if (finalName === oldName) { setRenaming(null); return }
    await onRenameConfigFile(oldName, finalName)
    setRenaming(null)
  }, [onRenameConfigFile])

  /* ── Optimistic node helper ── */

  const addOptimisticAgentFiles = useCallback((names: string[]) => {
    setAgentFiles(prev => {
      const existingNames = new Set(prev.map(n => n.name))
      const unique = names.filter(n => !existingNames.has(n))
      return [...prev, ...unique.map(name => ({ name, type: 'file' as const, path: name }))]
    })
  }, [])

  // ── Stable ref for fetchAgentFiles (used by native event handlers) ──

  const fetchAgentFilesRef = useRef(fetchAgentFiles)
  fetchAgentFilesRef.current = fetchAgentFiles
  const addOptimisticRef = useRef(addOptimisticAgentFiles)
  addOptimisticRef.current = addOptimisticAgentFiles

  const handlePasteAgents = useCallback(async () => {
    const api = window.electronAPI
    if (!api?.readClipboardFiles) {
      console.warn('[agents-panel] electron clipboard API unavailable')
      return
    }

    try {
      const files = await api.readClipboardFiles()
      console.log('[agents-panel] clipboard files', { files })
      if (files.length === 0) {
        console.warn('[agents-panel] no clipboard files returned')
        return
      }

      const names = files.map((f: string) => f.split('/').pop()!).filter(Boolean)
      if (names.length > 0) addOptimisticRef.current(names)

      const res = await fetch(`/api/workspaces/${workspaceId}/fs/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourcePaths: files, destinationFolder: 'agents' }),
      })
      console.log('[agents-panel] import response', { ok: res.ok, status: res.status })
      if (!res.ok) console.warn('[agents-panel] import failed body:', await res.text())
    } catch (error) {
      console.error('[agents-panel] clipboard paste failed', error)
    }

    fetchAgentFilesRef.current()
  }, [workspaceId])

  useEffect(() => {
    const container = subAgentsRef.current
    if (!container) return

    const hasFileType = (dt: DataTransfer | null) => {
      const t = dt?.types
      if (!t) return false
      return typeof t.includes === 'function' ? t.includes('Files') : (t as unknown as DOMStringList).contains('Files')
    }

    const handleDragEnter = (e: DragEvent) => {
      if (!hasFileType(e.dataTransfer)) return
      e.preventDefault()
      setIsDraggingExternal(true)
    }

    const handleDragOver = (e: DragEvent) => {
      if (!hasFileType(e.dataTransfer)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
      setIsDraggingExternal(true)
    }

    const handleDrop = async (e: DragEvent) => {
      e.preventDefault()
      setIsDraggingExternal(false)

      const files = e.dataTransfer?.files
      if (!files || files.length === 0) return

      const sourcePaths: string[] = []
      for (let i = 0; i < files.length; i++) {
        const file = files[i] as File & { path?: string }
        if (file.path) sourcePaths.push(file.path)
      }

      if (sourcePaths.length > 0) {
        // Optimistic: add placeholder file nodes immediately
        const names = sourcePaths.map(p => p.split('/').pop()!).filter(Boolean)
        if (names.length > 0) addOptimisticRef.current(names)

        try {
          await fetch(`/api/workspaces/${workspaceId}/fs/import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sourcePaths, destinationFolder: 'agents' }),
          })
        } catch { /* ignore */ }
        fetchAgentFilesRef.current() // always refresh to get real state
      }
    }

    const handleDragLeave = (e: DragEvent) => {
      if (!container.contains(e.relatedTarget as Node)) {
        setIsDraggingExternal(false)
      }
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
  }, [workspaceId])

  // ── Paste from system clipboard for Sub-Agents ──

  useEffect(() => {
    const el = subAgentsRef.current
    if (!el) return

    const handler = async (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      const isMod = e.metaKey || e.ctrlKey
      if (isMod && e.key === 'v') {
        e.preventDefault()
        await handlePasteAgents()
      }
    }

    el.addEventListener('keydown', handler)
    return () => el.removeEventListener('keydown', handler)
  }, [handlePasteAgents])

  // Filter
  const filteredConfigFiles = search
    ? configFiles.filter(f => f.toLowerCase().includes(search.toLowerCase()))
    : configFiles

  const filteredAgentFiles = search
    ? agentFiles.filter(f => f.name.toLowerCase().includes(search.toLowerCase()))
    : agentFiles

  const isFileSelected = (filename: string) =>
    selection?.type === 'file' && selection.filename === filename

  const isSubAgentSelected = (path: string) =>
    selection?.type === 'subagent' && selection.filename === path

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between h-11 px-3.5 border-b border-subtle shrink-0">
        <span className="text-[13px] font-semibold text-primary">{t('manage.agents')}</span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowSearch(v => !v)}
            className="text-tertiary hover:text-secondary transition-colors"
            title={t('button.search')}
          >
            <Search size={14} />
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
              onChange={e => setSearch(e.target.value)}
              placeholder={t('input.search')}
              className="flex-1 bg-transparent text-[12px] text-primary placeholder:text-muted outline-none"
              autoFocus
            />
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-2 py-2">

        {/* ── Sub-Agents (global, shared across projects) ── */}
        <div
          ref={subAgentsRef}
          tabIndex={0}
          className={cn('outline-none', isDraggingExternal && 'ring-2 ring-indigo/40 ring-inset rounded-md')}
        >
          <div className="flex items-center justify-between px-2 py-1">
            <button
              onClick={() => setSubAgentsExpanded(v => !v)}
              className="flex items-center gap-1 text-[10px] font-semibold text-muted uppercase tracking-wider"
            >
              {subAgentsExpanded
                ? <ChevronDown size={10} className="text-muted" />
                : <ChevronRight size={10} className="text-muted" />}
              {t('manage.subAgents')}
            </button>
            <button
              onClick={() => setCreatingAgent(true)}
              className="text-indigo hover:opacity-80 transition-opacity"
              title={t('button.newAgentFile')}
            >
              <FilePlus size={12} />
            </button>
          </div>

          {subAgentsExpanded && (
            <>
              {/* Inline create input */}
              {creatingAgent && (
                <InlineCreateInput
                  onSubmit={handleCreateAgentSubmit}
                  onCancel={() => setCreatingAgent(false)}
                />
              )}
              {filteredAgentFiles.map(node => (
                <div key={node.path}>
                  {renaming?.section === 'subagent' && renaming.path === node.path ? (
                    <div className="flex items-center gap-1.5 w-full h-7 px-2">
                      <FileText size={12} className="text-indigo shrink-0" />
                      <input
                        autoFocus
                        defaultValue={renaming.value}
                        className="text-[11px] text-primary bg-transparent outline-none border-b border-indigo flex-1"
                        onBlur={(e) => handleRenameAgent(node.path, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRenameAgent(node.path, e.currentTarget.value)
                          if (e.key === 'Escape') setRenaming(null)
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                  ) : (
                    <div
                      onClick={() => onSelect({ type: 'subagent', filename: node.path })}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        setContextMenu({ x: e.clientX, y: e.clientY, targetPath: node.path, targetSection: 'subagent' })
                      }}
                      className={cn(
                        'flex items-center gap-1.5 w-full h-7 px-2 rounded-md text-[11px] cursor-pointer transition-colors',
                        isSubAgentSelected(node.path)
                          ? 'bg-elevated text-primary font-semibold'
                          : 'text-secondary hover:bg-surface-hover'
                      )}
                    >
                      <FileText size={12} className={isSubAgentSelected(node.path) ? 'text-indigo' : 'text-tertiary'} />
                      <span className="truncate flex-1">{node.name}</span>
                    </div>
                  )}
                </div>
              ))}

              {agentFiles.length === 0 && !search && !creatingAgent && (
                <div
                  className="px-2 py-6"
                  onContextMenu={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setContextMenu({ x: e.clientX, y: e.clientY, targetPath: '', targetSection: 'subagent', targetType: 'root' })
                  }}
                >
                  <div className="flex flex-col items-center text-center gap-3">
                    <p className="text-[10px] text-muted">{t('status.noSubAgents')}</p>
                    <button
                      type="button"
                      onClick={() => void handlePasteAgents()}
                      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-[12px] font-medium text-primary bg-elevated hover:bg-surface-hover transition-colors"
                    >
                      <ClipboardPaste size={12} className="text-tertiary" />
                      <span>{t('contextMenu.paste')}</span>
                    </button>
                    <p className="text-[10px] text-muted">{shortcutLabel}V</p>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* spacer */}
        <div className="h-4" />
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed bg-surface border border-subtle rounded-lg shadow-lg z-50 py-1 w-[160px] animate-slide-down"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.targetSection === 'subagent' && contextMenu.targetType === 'root' ? (
            <button
              onClick={() => {
                void handlePasteAgents()
                setContextMenu(null)
              }}
              className="flex items-center justify-between w-full px-3 py-1.5 text-[12px] text-primary hover:bg-surface-hover transition-colors"
            >
              <span className="flex items-center gap-2">
                <ClipboardPaste size={12} className="text-tertiary" /> {t('contextMenu.paste')}
              </span>
              <span className="text-[10px] text-muted">{shortcutLabel}V</span>
            </button>
          ) : (
            <>
              <button
                onClick={() => {
                  setRenaming({
                    path: contextMenu.targetPath,
                    section: contextMenu.targetSection,
                    value: contextMenu.targetPath.split('/').pop() || contextMenu.targetPath,
                  })
                  setContextMenu(null)
                }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] text-primary hover:bg-surface-hover transition-colors"
              >
                <Pencil size={12} className="text-tertiary" /> {t('common.rename')}
              </button>
              <button
                onClick={() => {
                  if (contextMenu.targetSection === 'config') {
                    onDeleteConfigFile(contextMenu.targetPath)
                  } else {
                    handleDeleteAgent(contextMenu.targetPath)
                  }
                  setContextMenu(null)
                }}
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

/* ── Inline Create Input ── */
function InlineCreateInput({
  onSubmit,
  onCancel,
}: {
  onSubmit: (name: string) => void
  onCancel: () => void
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
    <div className="flex items-center gap-1.5 h-7 px-2">
      <FileText size={12} className="text-tertiary shrink-0" />
      <input
        ref={inputRef}
        type="text"
        className="flex-1 text-[11px] text-primary bg-elevated outline-none border border-indigo/50 rounded px-1.5 py-0.5 h-[20px]"
        placeholder={t('input.fileName')}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
      />
    </div>
  )
}
