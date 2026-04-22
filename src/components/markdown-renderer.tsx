'use client'

import { useState, useEffect, useCallback, memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'
import { Check, Copy } from 'lucide-react'
import { t } from '@/lib/i18n'

// All supported code themes
const CODE_THEMES = ['github-dark', 'github-light', 'monokai', 'one-dark-pro', 'dracula', 'nord'] as const

// Shiki highlighter singleton (lazy-loaded)
let highlighterPromise: Promise<unknown> | null = null

function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = import('shiki').then(({ createHighlighter }) =>
      createHighlighter({
        themes: [...CODE_THEMES],
        langs: [
          'javascript', 'typescript', 'python', 'bash', 'json', 'html', 'css',
          'jsx', 'tsx', 'sql', 'yaml', 'markdown', 'rust', 'go', 'java', 'c',
          'cpp', 'shell', 'diff', 'xml', 'toml',
        ],
      })
    )
  }
  return highlighterPromise
}

/** Read the user-selected code theme from data-code-theme attribute, with light mode fallback */
function getShikiTheme(): string {
  if (typeof document === 'undefined') return 'github-dark'
  const codeTheme = document.documentElement.getAttribute('data-code-theme')
  if (codeTheme && CODE_THEMES.includes(codeTheme as typeof CODE_THEMES[number])) {
    return codeTheme
  }
  // Fallback: if no code theme set, use github-light for light mode
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'github-light' : 'github-dark'
}

/** Hook to track code theme changes via MutationObserver */
function useCodeTheme(): string {
  const [theme, setTheme] = useState(() => getShikiTheme())
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setTheme(getShikiTheme())
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-code-theme', 'data-theme'] })
    return () => observer.disconnect()
  }, [])
  return theme
}

// Preload highlighter on module load
if (typeof window !== 'undefined') {
  getHighlighter()
}

/* ── Copy Button ── */

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    const api = window.electronAPI
    if (api?.copyToClipboard) {
      await api.copyToClipboard(text)
    } else {
      await navigator.clipboard.writeText(text)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [text])

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-muted hover:text-primary transition-colors"
      title={t("button.copyCode")}
    >
      {copied ? (
        <>
          <Check size={12} className="text-green" />
          <span className="text-green">{t('button.copied')}</span>
        </>
      ) : (
        <>
          <Copy size={12} />
          <span>{t('button.copy')}</span>
        </>
      )}
    </button>
  )
}

const SYSTEM_MONO = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'

/* ── Code Block with Shiki ── */

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [html, setHtml] = useState<string | null>(null)
  const codeTheme = useCodeTheme()

  // Use custom diff renderer for diff blocks
  const isDiff = lang === 'diff'

  useEffect(() => {
    if (isDiff) return // Skip Shiki for diff — use custom renderer
    let cancelled = false
    getHighlighter().then((hl) => {
      if (cancelled) return
      const highlighter = hl as {
        codeToHtml: (code: string, opts: { lang: string; theme: string }) => string
        getLoadedLanguages: () => string[]
      }
      const loadedLangs = highlighter.getLoadedLanguages()
      const effectiveLang = loadedLangs.includes(lang) ? lang : 'text'
      try {
        const result = highlighter.codeToHtml(code, { lang: effectiveLang, theme: codeTheme })
        setHtml(result)
      } catch {
        setHtml(null)
      }
    }).catch(() => {})
    return () => { cancelled = true }
  }, [lang, code, isDiff, codeTheme])

  return (
    <div className="my-2 rounded-lg overflow-hidden border border-subtle group/code">
      <div className="flex items-center justify-between px-3 py-1 bg-surface-active border-b border-subtle">
        <span className="text-[11px] text-muted" style={{ fontFamily: SYSTEM_MONO }}>{lang || 'code'}</span>
        <CopyButton text={code} />
      </div>
      {isDiff ? (
        <DiffView code={code} />
      ) : html ? (
        <div
          className="px-3 py-2 text-[12px] overflow-x-auto [&_pre]:!bg-transparent [&_pre]:!m-0 [&_pre]:!p-0 [&_code]:!bg-transparent bg-elevated"
          style={{ fontFamily: SYSTEM_MONO }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="px-3 py-2 bg-elevated text-[12px] text-primary overflow-x-auto" style={{ fontFamily: SYSTEM_MONO }}>
          <code>{code}</code>
        </pre>
      )}
    </div>
  )
}

/* ── Diff Viewer ── */

function DiffView({ code }: { code: string }) {
  const lines = code.split('\n')
  return (
    <pre className="text-[12px] overflow-x-auto" style={{ fontFamily: SYSTEM_MONO }}>
      {lines.map((line, i) => {
        let bg = 'bg-transparent'
        let color = 'text-primary'
        if (line.startsWith('+')) {
          bg = 'bg-green/10'
          color = 'text-green'
        } else if (line.startsWith('-')) {
          bg = 'bg-coral/10'
          color = 'text-coral'
        } else if (line.startsWith('@@')) {
          bg = 'bg-indigo/10'
          color = 'text-indigo'
        }
        return (
          <div key={i} className={`px-3 py-0 ${bg} ${color}`}>
            {line || ' '}
          </div>
        )
      })}
    </pre>
  )
}

/* ── Markdown Components ── */

const components: Components = {
  code({ className, children, ...props }) {
    const match = /language-(\w+)/.exec(className || '')
    const isBlock = match || (typeof children === 'string' && children.includes('\n'))

    if (isBlock) {
      const lang = match?.[1] || ''
      const code = String(children).replace(/\n$/, '')
      return <CodeBlock lang={lang} code={code} />
    }

    return (
      <code className="px-1 py-0.5 rounded bg-surface-active text-[12px] text-indigo" style={{ fontFamily: SYSTEM_MONO }} {...props}>
        {children}
      </code>
    )
  },
  pre({ children }) {
    // Let the code component handle rendering
    return <>{children}</>
  },
  p({ children }) {
    return <p className="mb-2 last:mb-0">{children}</p>
  },
  ul({ children }) {
    return <ul className="mb-2 ml-4 list-disc space-y-1">{children}</ul>
  },
  ol({ children }) {
    return <ol className="mb-2 ml-4 list-decimal space-y-1">{children}</ol>
  },
  li({ children }) {
    return <li className="text-primary">{children}</li>
  },
  h1({ children }) {
    return <h1 className="text-[16px] font-bold text-primary mt-4 mb-2">{children}</h1>
  },
  h2({ children }) {
    return <h2 className="text-[15px] font-bold text-primary mt-3 mb-2">{children}</h2>
  },
  h3({ children }) {
    return <h3 className="text-[14px] font-semibold text-primary mt-2 mb-1">{children}</h3>
  },
  blockquote({ children }) {
    return (
      <blockquote className="border-l-2 border-indigo/50 pl-3 my-2 text-secondary italic">
        {children}
      </blockquote>
    )
  },
  a({ href, children }) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="text-indigo hover:underline">
        {children}
      </a>
    )
  },
  table({ children }) {
    return (
      <div className="my-2 overflow-x-auto rounded-lg border border-subtle">
        <table className="w-full text-[12px]">{children}</table>
      </div>
    )
  },
  thead({ children }) {
    return <thead className="bg-surface-active">{children}</thead>
  },
  th({ children }) {
    return <th className="px-3 py-1.5 text-left text-muted font-medium border-b border-subtle">{children}</th>
  },
  td({ children }) {
    return <td className="px-3 py-1.5 border-b border-subtle">{children}</td>
  },
  hr() {
    return <hr className="my-3 border-subtle" />
  },
  img({ src, alt }) {
    return (
      <span className="inline-block my-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt || ''}
          className="max-w-[400px] max-h-[300px] rounded-lg border border-subtle object-contain"
          loading="lazy"
        />
      </span>
    )
  },
}

/* ── Main Component ── */

export const MarkdownRenderer = memo(function MarkdownRenderer({ content }: { content: string }) {
  return (
    <div className="text-primary leading-relaxed" style={{ fontSize: 'var(--forge-font-size, 14px)' }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  )
})
