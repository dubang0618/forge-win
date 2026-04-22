'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { ChevronRight, ChevronDown, Loader2, CheckCircle, XCircle } from 'lucide-react'
import type { ContentBlock, AgentSubBlock, ToolRawContent } from '@/lib/types'
import { MarkdownRenderer } from '@/components/markdown-renderer'
import { t } from '@/lib/i18n'

/* ── Agent Color Palette ── */
const AGENT_COLORS = [
  '#6366F1', // indigo
  '#10B981', // emerald
  '#F59E0B', // amber
  '#F43F5E', // rose
  '#06B6D4', // cyan
  '#8B5CF6', // violet
  '#F97316', // orange
  '#14B8A6', // teal
]

/** Deterministic color from agent name */
function getAgentColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0
  }
  return AGENT_COLORS[Math.abs(hash) % AGENT_COLORS.length]
}

/** Check if a tool_use block is a sub-agent call */
export function isAgentToolCall(name: string): boolean {
  return name === 'Agent' || name === 'delegate_to_agent'
}

/* ── Tool Summary Aggregation ── */

function parseToolSummary(resultContent?: string): string {
  if (!resultContent) return ''
  const counts: Record<string, number> = {}
  const patterns: [RegExp, string][] = [
    [/\bread\b.*?(\d+)\s*file/gi, 'Read'],
    [/\bedited?\b.*?(\d+)\s*file/gi, 'Edited'],
    [/\bwrote\b.*?(\d+)\s*file/gi, 'Wrote'],
    [/\bran\b.*?(\d+)\s*command/gi, 'Ran'],
    [/\bsearch/gi, 'Search'],
    [/\bgrep/gi, 'Grep'],
  ]
  for (const [re, label] of patterns) {
    const m = resultContent.match(re)
    if (m) counts[label] = (counts[label] || 0) + m.length
  }
  if (Object.keys(counts).length === 0) return ''
  return Object.entries(counts)
    .map(([k, v]) => `${k} ${v} ${v === 1 ? 'file' : 'files'}`)
    .join(' · ')
}

/* ── Format Helpers ── */

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m ${s}s`
}

/* ── Tool Display Helpers (shared with ToolUseBlock in chat-view) ── */

function getToolDisplayName(name: string): string {
  const map: Record<string, string> = {
    Read: 'Read', Write: 'Write', Edit: 'Edit', Bash: 'Bash',
    Glob: 'Glob', Grep: 'Grep', WebSearch: 'Web Search', WebFetch: 'Web Fetch',
    Agent: 'Agent', Skill: 'Skill',
  }
  return map[name] || name
}

function getToolSummary(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'Read': return String(input.file_path || input.path || '').split('/').pop() || ''
    case 'Write': return String(input.file_path || input.path || '').split('/').pop() || ''
    case 'Edit': return String(input.file_path || input.path || '').split('/').pop() || ''
    case 'Bash': return String(input.command || '').slice(0, 80)
    case 'Glob': return String(input.pattern || '')
    case 'Grep': return String(input.pattern || '')
    case 'WebSearch': return String(input.query || '')
    case 'WebFetch': return String(input.url || '').slice(0, 60)
    default: return ''
  }
}

/* ── Hint Text (localStorage) ── */

const HINT_KEY = 'forge:agent-block-hint-dismissed'

function useHintDismissed(): [boolean, () => void] {
  const [dismissed, setDismissed] = useState(true)
  useEffect(() => {
    setDismissed(localStorage.getItem(HINT_KEY) === '1')
  }, [])
  const dismiss = useCallback(() => {
    localStorage.setItem(HINT_KEY, '1')
    setDismissed(true)
  }, [])
  return [dismissed, dismiss]
}

/* ── Mini Sub-Components for structured rendering ── */

/** Mini tool use row (compact, single-line with expand) */
function MiniToolUse({ block, subBlocks }: { block: AgentSubBlock & { type: 'tool_use' }; subBlocks: AgentSubBlock[] }) {
  const [expanded, setExpanded] = useState(false)
  const summary = getToolSummary(block.name, block.input)
  const result = subBlocks.find(
    (b) => b.type === 'tool_result' && b.tool_use_id === block.id
  ) as (AgentSubBlock & { type: 'tool_result' }) | undefined
  const progress = subBlocks.find(
    (b) => b.type === 'tool_progress' && b.tool_use_id === block.id
  ) as (AgentSubBlock & { type: 'tool_progress' }) | undefined
  const isDone = !!result
  const isError = result?.is_error

  return (
    <div className="my-0.5">
      <button
        onClick={() => result && setExpanded(!expanded)}
        className="flex items-center gap-1.5 w-full text-left py-0.5 hover:opacity-80 transition-opacity text-[12px]"
      >
        <span className={`font-semibold shrink-0 ${isDone && !isError ? 'text-green' : isError ? 'text-coral' : 'text-secondary'}`}>
          {getToolDisplayName(block.name)}
        </span>
        {summary && <span className="text-tertiary truncate flex-1">{summary}</span>}
        {!isDone && progress && (
          <span className="text-muted font-mono text-[11px] shrink-0">{formatElapsed(progress.elapsed_time_seconds)}</span>
        )}
        {!isDone && !progress && (
          <Loader2 size={10} className="animate-spin text-muted shrink-0" />
        )}
        {isDone && result && (
          <ChevronRight size={10} className={`text-muted shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        )}
      </button>
      {expanded && result && (
        <div className="pl-5 py-1">
          <pre className="text-[11px] text-secondary font-mono whitespace-pre-wrap leading-relaxed max-h-[200px] overflow-y-auto">
            {result.content}
          </pre>
        </div>
      )}
    </div>
  )
}

/** Mini thinking panel (compact, collapsible) */
function MiniThinkingPanel({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="my-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-[12px] text-secondary hover:opacity-80 transition-opacity"
      >
        <span className="italic">{t('status.thinking')}</span>
        {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
      </button>
      {expanded && (
        <div className="mt-1 pl-5 py-2 bg-elevated rounded text-[12px] text-secondary italic leading-relaxed max-h-[300px] overflow-y-auto">
          {text}
        </div>
      )}
    </div>
  )
}

/** Parse raw resultContent into structured blocks (fallback for DB-loaded messages) */
function parseResultContentToBlocks(content: string): AgentSubBlock[] {
  if (!content) return []

  // Try to parse as JSON first (if backend stored structured data)
  try {
    const parsed = JSON.parse(content)
    if (Array.isArray(parsed)) {
      // Check if it looks like an array of blocks
      if (parsed.length > 0 && parsed[0]?.type) return parsed as AgentSubBlock[]
    }
  } catch { /* not JSON, treat as text */ }

  // Fallback: treat entire content as markdown text
  return [{ type: 'text', text: content }]
}

/* ── AgentBlock Component (Flat Inline Section) ── */

interface AgentBlockProps {
  toolUseId: string
  agentName: string
  task: string
  hasResult: boolean
  isResultError: boolean
  resultContent?: string
  rawContent?: ToolRawContent
  elapsedSeconds: number
  streaming: boolean
  /** All blocks in this message — used for sub-agent internal tool display */
  allBlocks?: ContentBlock[]
  /** Structured sub-blocks from real-time agent_content events */
  agentSubBlocks?: AgentSubBlock[]
}

export function AgentBlock({
  toolUseId,
  agentName,
  task,
  hasResult,
  isResultError,
  resultContent,
  elapsedSeconds,
  streaming,
  agentSubBlocks,
}: AgentBlockProps) {
  const [expanded, setExpanded] = useState(false)
  const [hintDismissed, dismissHint] = useHintDismissed()
  const color = getAgentColor(agentName)
  const isRunning = !hasResult && streaming

  // Local timer fallback (when tool_progress events are sparse)
  const [localElapsed, setLocalElapsed] = useState(0)
  const startTimeRef = useRef(Date.now())

  useEffect(() => {
    if (!isRunning) return
    startTimeRef.current = Date.now()
    const timer = setInterval(() => {
      setLocalElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000))
    }, 1000)
    return () => clearInterval(timer)
  }, [isRunning])

  const displayElapsed = elapsedSeconds > 0 ? elapsedSeconds : localElapsed

  // Keyboard shortcut: Cmd+E / Ctrl+E
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'e') {
        e.preventDefault()
        setExpanded(prev => !prev)
        if (!hintDismissed) dismissHint()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [hintDismissed, dismissHint])

  const handleToggle = () => {
    setExpanded(prev => !prev)
    if (!hintDismissed) dismissHint()
  }

  const toolSummary = parseToolSummary(resultContent)
  const displayName = agentName || 'agent'

  // Determine which blocks to render in expanded view
  const displayBlocks = useMemo((): AgentSubBlock[] => {
    // Prefer real-time streaming blocks — but ONLY if they have renderable content
    // (text, thinking, tool_use). tool_progress alone means the SDK only sent timer
    // updates, not actual sub-agent content, so fall back to resultContent.
    if (agentSubBlocks && agentSubBlocks.length > 0) {
      const hasContent = agentSubBlocks.some(b => b.type === 'text' || b.type === 'thinking' || b.type === 'tool_use')
      if (hasContent) return agentSubBlocks
    }
    // Fallback: parse resultContent for completed agents / DB-loaded messages
    if (resultContent) return parseResultContentToBlocks(resultContent)
    // Last resort: return whatever sub-blocks we have (even if only tool_progress)
    return agentSubBlocks || []
  }, [agentSubBlocks, resultContent])

  // Count sub-agent tool calls for summary
  const subToolCount = useMemo(() => {
    return displayBlocks.filter(b => b.type === 'tool_use').length
  }, [displayBlocks])

  return (
    <div className="my-1">
      {/* Header row — flat, no background/border */}
      <button
        onClick={handleToggle}
        className="flex items-center gap-2.5 w-full py-1 text-left hover:opacity-80 transition-opacity"
      >
        {/* Status icon */}
        {isRunning ? (
          <Loader2 size={14} className="animate-spin shrink-0" style={{ color }} />
        ) : isResultError ? (
          <XCircle size={14} className="text-coral shrink-0" />
        ) : (
          <CheckCircle size={14} className="shrink-0" style={{ color }} />
        )}

        {/* Agent name */}
        <span className="text-[13px] font-semibold shrink-0" style={{ color }}>
          {displayName}
        </span>

        {/* Spacer */}
        <span className="flex-1" />

        {/* Timer */}
        <span className="text-[12px] text-muted font-mono tabular-nums shrink-0">
          {formatElapsed(displayElapsed)}
        </span>

        {/* Expand chevron */}
        {expanded ? (
          <ChevronDown size={12} className="text-muted shrink-0" />
        ) : (
          <ChevronRight size={12} className="text-muted shrink-0" />
        )}
      </button>

      {/* Summary line */}
      {(task || toolSummary) && (
        <div className="pl-6 pb-1">
          <span className="text-[12px] text-tertiary">
            {toolSummary || (subToolCount > 0 ? `${subToolCount} tool calls` : task.slice(0, 120))}
          </span>
        </div>
      )}

      {/* Expanded content — structured rendering */}
      <div
        className="grid transition-[grid-template-rows] duration-250 ease-in-out"
        style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          {/* Dashed divider */}
          <div className="border-t border-dashed border-subtle my-1" />

          <div className="pl-4 py-2 space-y-1">
            {displayBlocks.length > 0 ? (
              displayBlocks.map((block, i) => {
                switch (block.type) {
                  case 'text':
                    return (
                      <div key={`text-${i}`} className="text-[13px]">
                        <MarkdownRenderer content={block.text} />
                      </div>
                    )
                  case 'thinking':
                    return <MiniThinkingPanel key={`think-${i}`} text={block.text} />
                  case 'tool_use':
                    return <MiniToolUse key={block.id} block={block} subBlocks={displayBlocks} />
                  case 'tool_result':
                  case 'tool_progress':
                    return null // Rendered inside MiniToolUse or ignored
                  default:
                    return null
                }
              })
            ) : isRunning ? (
              <div className="flex items-center gap-2">
                <Loader2 size={12} className="animate-spin text-muted" />
                <span className="text-[12px] text-secondary">{t('status.agentWorking')}</span>
              </div>
            ) : (
              <span className="text-[12px] text-muted">{t('status.noOutput')}</span>
            )}
          </div>

          {/* Hint text */}
          {!hintDismissed && (
            <div className="pl-4 pb-1">
              <span className="text-[11px] text-muted italic">
                Press {window.electronAPI?.platform === 'darwin' ? '⌘E' : 'Ctrl+E'} to expand agent context
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── Parallel Agent Indicator ── */

export function ParallelAgentIndicator({ count }: { count: number }) {
  if (count < 2) return null
  return (
    <div className="flex items-center gap-1.5 py-1 my-0.5">
      <Sparkle className="text-amber" />
      <span className="text-[12px] font-medium text-amber">
        {count} agents running
      </span>
    </div>
  )
}

function Sparkle({ className }: { className?: string }) {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  )
}
