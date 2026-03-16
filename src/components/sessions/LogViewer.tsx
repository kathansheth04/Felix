import { useState, useEffect, useRef, useMemo } from 'react'
import type { Execution, LogEntry, ExecutionLogEvent } from '../../types'
import { ScrollArea } from '../ui/scroll-area'
import { cn } from '../../lib/utils'
import { Search, X, ChevronUp, ChevronDown, ChevronRight } from 'lucide-react'

interface LogViewerProps {
  execution: Execution
  ticketTitle?: string
  runNumber?: number
}

// ─── Classification ───────────────────────────────────────────────────────────

type LogKind = 'system' | 'tool-use' | 'tool-result' | 'tool-result-error' | 'thinking' | 'sentinel' | 'agent'

function classifyLog(text: string): LogKind {
  if (text.startsWith('[system]'))        return 'system'
  if (text.startsWith('[tool:'))          return 'tool-use'
  if (text.startsWith('[result: error]')) return 'tool-result-error'
  if (text.startsWith('[result:'))        return 'tool-result'
  if (text.startsWith('[thinking]'))      return 'thinking'
  try { const p = JSON.parse(text); if (p.status) return 'sentinel' } catch { /* */ }
  return 'agent'
}

function parseTool(text: string) {
  const m = text.match(/^\[tool:\s*([^\]]+)\]\s*(.*)$/s)
  const name = m?.[1]?.trim() ?? ''
  const detail = m?.[2]?.trim() ?? ''
  return { name, detail, isMultiLine: detail.includes('\n') }
}

function parseResult(text: string) {
  const m = text.match(/^\[result:\s*([^\]]+)\]\s*(.*)$/s)
  const name = m?.[1]?.trim() ?? ''
  const detail = m?.[2]?.trim() ?? ''
  return { name, detail, isError: name === 'error', isMultiLine: detail.includes('\n') }
}

/** Tool colors — semantic tokens (primary, success, warning, violet, teal) */
const TOOL_COLOR: Record<string, string> = {
  Read: 'text-primary', Write: 'text-success', Bash: 'text-warning',
  Grep: 'text-violet', Glob: 'text-teal',
  StrReplace: 'text-success', Edit: 'text-success',
}
const TOOL_BG: Record<string, string> = {
  Read: 'bg-primary', Write: 'bg-success', Bash: 'bg-warning',
  Grep: 'bg-violet', Glob: 'bg-teal',
  StrReplace: 'bg-success', Edit: 'bg-success',
}
const toolColor = (n: string) => TOOL_COLOR[n] ?? 'text-muted-foreground'
const toolBg    = (n: string) => TOOL_BG[n]    ?? 'bg-muted-foreground/50'

// ─── Event grouping ───────────────────────────────────────────────────────────

type LogEvent =
  | { kind: 'agent';        entry: LogEntry; idx: number }
  | { kind: 'system-group'; entries: LogEntry[]; startIdx: number }
  | { kind: 'thinking';     entry: LogEntry; idx: number }
  | { kind: 'sentinel';     entry: LogEntry; idx: number }
  | { kind: 'tool';         use: LogEntry; useIdx: number; result: LogEntry | null; resultIdx: number | null }

function buildEvents(logs: LogEntry[]): LogEvent[] {
  const events: LogEvent[] = []
  let i = 0
  while (i < logs.length) {
    const entry = logs[i]
    const text = entry.message.trim()
    if (!text) { i++; continue }
    const kind = classifyLog(text)

    if (kind === 'tool-use') {
      const next = i + 1 < logs.length ? logs[i + 1] : null
      const nextKind = next ? classifyLog(next.message.trim()) : null
      if (nextKind === 'tool-result' || nextKind === 'tool-result-error') {
        events.push({ kind: 'tool', use: entry, useIdx: i, result: next, resultIdx: i + 1 })
        i += 2
      } else {
        events.push({ kind: 'tool', use: entry, useIdx: i, result: null, resultIdx: null })
        i += 1
      }
    } else if (kind === 'tool-result' || kind === 'tool-result-error') {
      i++ // orphan result — skip
    } else if (kind === 'system') {
      // Collect all consecutive system messages into one group
      const startIdx = i
      const entries: LogEntry[] = []
      while (i < logs.length) {
        const t = logs[i].message.trim()
        if (t && classifyLog(t) === 'system') { entries.push(logs[i]); i++ }
        else if (!t) { i++ }
        else break
      }
      events.push({ kind: 'system-group', entries, startIdx })
    } else {
      events.push({ kind: kind as 'agent' | 'thinking' | 'sentinel', entry, idx: i })
      i++
    }
  }
  return events
}

function resultSummary(text: string, isError: boolean): string {
  const { detail, isMultiLine } = parseResult(text)
  if (isError) return 'error'
  if (detail === '✓') return 'written'
  if (isMultiLine) {
    const n = detail.split('\n').length
    return `${n} lines`
  }
  return detail
}

// ─── Search ───────────────────────────────────────────────────────────────────

interface SearchCtx { query: string; logMatchOffset: number; activeIndex: number }

function countMatches(text: string, query: string): number {
  if (!query) return 0
  const lq = query.toLowerCase(), lt = text.toLowerCase()
  let n = 0, idx = 0
  while ((idx = lt.indexOf(lq, idx)) !== -1) { n++; idx += lq.length }
  return n
}

function HighlightedText({ text, query, startOffset, activeIndex }: {
  text: string; query: string; startOffset: number; activeIndex: number
}) {
  if (!query || !text) return <>{text}</>
  const lq = query.toLowerCase(), lt = text.toLowerCase()
  const parts: React.ReactNode[] = []
  let last = 0, count = 0, idx = lt.indexOf(lq)
  while (idx !== -1) {
    if (idx > last) parts.push(text.slice(last, idx))
    const isActive = startOffset + count === activeIndex
    parts.push(
      <mark key={`${idx}-${count}`} id={isActive ? 'log-search-active' : undefined}
        className={cn('rounded-[2px]', isActive ? 'bg-orange-400 text-black' : 'bg-yellow-400/40 text-inherit')}>
        {text.slice(idx, idx + query.length)}
      </mark>
    )
    count++; last = idx + query.length; idx = lt.indexOf(lq, last)
  }
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts}</>
}

function HT({ text, sc, offset }: { text: string; sc?: SearchCtx; offset: number }) {
  if (!sc) return <>{text}</>
  return <HighlightedText text={text} query={sc.query} startOffset={offset} activeIndex={sc.activeIndex} />
}

// ─── Component ────────────────────────────────────────────────────────────────

export function LogViewer({ execution, ticketTitle, runNumber }: LogViewerProps) {
  const [logs, setLogs]           = useState<LogEntry[]>([])
  const [loading, setLoading]     = useState(false)
  const [searchOpen, setSearchOpen]   = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeMatchIdx, setActiveMatchIdx] = useState(0)
  const bottomRef     = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const isLive = execution.status === 'IN_PROGRESS'

  useEffect(() => {
    setLogs([]); setLoading(true)
    window.api.getExecutionLogs({ execution_id: execution.id })
      .then(setLogs).catch(console.error).finally(() => setLoading(false))
  }, [execution.id])

  useEffect(() => {
    if (!isLive) return
    const unsub = window.api.onExecutionLog((data: ExecutionLogEvent) => {
      if (data.execution_id !== execution.id) return
      setLogs(prev => [...prev, {
        id: `live-${Date.now()}-${Math.random()}`,
        execution_id: data.execution_id, step: null,
        message: data.message, timestamp: data.timestamp,
      }])
    })
    return unsub
  }, [execution.id, isLive])

  useEffect(() => {
    if (searchOpen) return
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs.length, searchOpen])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault(); setSearchOpen(true)
        setTimeout(() => { searchInputRef.current?.focus(); searchInputRef.current?.select() }, 30)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const events = useMemo(() => buildEvents(logs), [logs])

  const { totalMatches, matchOffsets } = useMemo(() => {
    if (!searchQuery.trim()) return { totalMatches: 0, matchOffsets: [] }
    let running = 0
    const matchOffsets = logs.map(log => {
      const start = running
      running += countMatches(log.message.trim(), searchQuery)
      return start
    })
    return { totalMatches: running, matchOffsets }
  }, [logs, searchQuery])

  useEffect(() => {
    if (totalMatches === 0) setActiveMatchIdx(0)
    else setActiveMatchIdx(i => Math.min(i, totalMatches - 1))
  }, [totalMatches])

  useEffect(() => {
    if (!searchQuery || totalMatches === 0) return
    requestAnimationFrame(() => {
      document.getElementById('log-search-active')?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
  }, [activeMatchIdx, searchQuery, totalMatches])

  const makeSc = (idx: number): SearchCtx | undefined =>
    searchQuery.trim()
      ? { query: searchQuery, logMatchOffset: matchOffsets[idx] ?? 0, activeIndex: activeMatchIdx }
      : undefined

  function openSearch() {
    setSearchOpen(true)
    setTimeout(() => { searchInputRef.current?.focus(); searchInputRef.current?.select() }, 30)
  }
  function closeSearch() { setSearchOpen(false); setSearchQuery(''); setActiveMatchIdx(0) }
  function nextMatch() { if (totalMatches > 0) setActiveMatchIdx(i => (i + 1) % totalMatches) }
  function prevMatch() { if (totalMatches > 0) setActiveMatchIdx(i => (i - 1 + totalMatches) % totalMatches) }

  const statusColors: Record<string, string> = {
    IN_PROGRESS: 'text-teal', COMPLETED: 'text-success',
    FAILED: 'text-destructive', CANCELLED: 'text-muted-foreground', CRASHED: 'text-warning',
  }

  return (
    <div className="flex flex-col h-full bg-background/60">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between h-10 px-5 border-b border-border/50 shrink-0">
        <div className="min-w-0">
          {ticketTitle && <p className="text-xs text-muted-foreground truncate mb-0.5">{ticketTitle}</p>}
          <div className="flex items-center gap-2.5">
            <span className="text-sm font-semibold">
              {runNumber != null ? `Run #${runNumber}` : 'Run'}
            </span>
            <span className="text-xs text-zinc-400 capitalize">{execution.mode.toLowerCase()}</span>
            {isLive && (
              <span className="flex items-center gap-1 text-xs font-medium text-teal">
                <span className="h-1.5 w-1.5 rounded-full bg-teal animate-status-pulse" />
                Live
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={cn('text-xs font-medium', statusColors[execution.status] ?? 'text-muted-foreground')}>
            {execution.status}
          </span>
          <span className="text-xs text-muted-foreground/80">{logs.length}</span>
          <button onClick={openSearch} title="Search (⌘F)"
            className="p-1.5 rounded hover:bg-secondary/60 text-muted-foreground/40 hover:text-foreground transition-colors">
            <Search className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* ── Search bar ─────────────────────────────────────────────────────── */}
      {searchOpen && (
        <div className="flex items-center gap-2 px-4 py-1.5 border-b border-border/50 shrink-0">
          <Search className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
          <input ref={searchInputRef} value={searchQuery}
            onChange={e => { setSearchQuery(e.target.value); setActiveMatchIdx(0) }}
            onKeyDown={e => {
              if (e.key === 'Escape') closeSearch()
              else if (e.key === 'Enter') e.shiftKey ? prevMatch() : nextMatch()
            }}
            placeholder="Search logs…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/30" />
          {searchQuery && (
            <span className={cn('text-xs shrink-0 tabular-nums',
              totalMatches === 0 ? 'text-red-400/70' : 'text-muted-foreground/50')}>
              {totalMatches === 0 ? 'No matches' : `${activeMatchIdx + 1} / ${totalMatches}`}
            </span>
          )}
          <div className="flex items-center gap-0.5 shrink-0">
            <button onClick={prevMatch} disabled={totalMatches === 0} className="p-1 rounded hover:bg-secondary disabled:opacity-30"><ChevronUp className="h-3.5 w-3.5" /></button>
            <button onClick={nextMatch} disabled={totalMatches === 0} className="p-1 rounded hover:bg-secondary disabled:opacity-30"><ChevronDown className="h-3.5 w-3.5" /></button>
            <button onClick={closeSearch} className="p-1 rounded hover:bg-secondary ml-0.5"><X className="h-3.5 w-3.5" /></button>
          </div>
        </div>
      )}

      {/* ── Log stream ─────────────────────────────────────────────────────── */}
      <ScrollArea className="flex-1 min-w-0 overflow-x-hidden">
        <div className="px-5 py-4 min-w-0 overflow-x-hidden">
          {loading && logs.length === 0 && (
            <div className="text-xs text-muted-foreground py-8 text-center animate-pulse">Loading…</div>
          )}

          {events.map((event, ei) => {
            if (event.kind === 'tool') {
              return (
                <ToolBlock key={event.use.id ?? event.useIdx}
                  use={event.use} result={event.result}
                  scUse={makeSc(event.useIdx)}
                  scResult={event.result && event.resultIdx != null ? makeSc(event.resultIdx) : undefined}
                />
              )
            }
            if (event.kind === 'agent') {
              return <AgentBlock key={event.entry.id ?? ei} entry={event.entry} sc={makeSc(event.idx)} />
            }
            if (event.kind === 'system-group') {
              return (
                <SystemGroupBlock key={`sys-${event.startIdx}`}
                  entries={event.entries} startIdx={event.startIdx} makeSc={makeSc} />
              )
            }
            if (event.kind === 'thinking') {
              return <ThinkingBlock key={event.entry.id ?? ei} entry={event.entry} sc={makeSc(event.idx)} />
            }
            if (event.kind === 'sentinel') {
              return <SentinelBlock key={event.entry.id ?? ei} entry={event.entry} sc={makeSc(event.idx)} />
            }
            return null
          })}

          {isLive && (
            <div className="flex items-center gap-2 mt-4 text-xs text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-pulse" />
              waiting
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>
    </div>
  )
}

// ─── Blocks ───────────────────────────────────────────────────────────────────

// ── Agent narration ───────────────────────────────────────────────────────────
function AgentBlock({ entry, sc }: { entry: LogEntry; sc?: SearchCtx }) {
  const text = entry.message.trim()
  const offset = sc?.logMatchOffset ?? 0
  return (
    <div className="my-3 text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap break-words">
      <HT text={text} sc={sc} offset={offset} />
    </div>
  )
}

// ── System messages — collapsible group ──────────────────────────────────────
const FAILURE_RE = /\b(error|fail|failed|failure|exception|crash|aborted|traceback|stderr)\b/i

function isFailureMessage(text: string) {
  return FAILURE_RE.test(text)
}

function SystemGroupBlock({ entries, startIdx, makeSc }: {
  entries: LogEntry[]
  startIdx: number
  makeSc: (idx: number) => SearchCtx | undefined
}) {
  const bodies = entries.map(e => {
    const text = e.message.trim()
    const prefix = text.match(/^\[system\]\s*/)?.[0] ?? ''
    return text.slice(prefix.length)
  })

  const failures = bodies.map(isFailureMessage)
  const anyFailure = failures.some(Boolean)

  // Auto-expand if any entry has a search match or a failure
  const scs = entries.map((_, i) => makeSc(startIdx + i))
  const hasMatch = scs.some((sc, i) => sc ? countMatches(bodies[i], sc.query) > 0 : false)

  const single = entries.length === 1
  const [open, setOpen] = useState(single)
  const show = open || hasMatch || anyFailure

  return (
    <div className="my-2 font-mono">
      {single ? (
        <SystemMessageRow body={bodies[0]} sc={scs[0]} isFail={failures[0]}
          prefix={entries[0].message.trim().match(/^\[system\]\s*/)?.[0] ?? ''} />
      ) : (
        <>
          <button
            onClick={() => setOpen(v => !v)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 transition-transform', show && 'rotate-90')} />
            {anyFailure && <span className="h-1.5 w-1.5 rounded-full bg-destructive shrink-0" />}
            <span>{entries.length} setup messages</span>
            {!show && (
              <span className="text-muted-foreground/80 ml-1 truncate max-w-[300px]">
                — {bodies[bodies.length - 1].toLowerCase()}
              </span>
            )}
          </button>
          {show && (
            <div className="mt-1 ml-[18px] space-y-0.5">
              {bodies.map((body, i) => (
                <SystemMessageRow key={i} body={body} sc={scs[i]} isFail={failures[i]}
                  prefix={entries[i].message.trim().match(/^\[system\]\s*/)?.[0] ?? ''} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function SystemMessageRow({ body, sc, isFail, prefix }: {
  body: string; sc?: SearchCtx; isFail: boolean; prefix: string
}) {
  const offset = sc ? sc.logMatchOffset + countMatches(prefix, sc.query) : 0
  return (
    <div className="flex items-start gap-1.5 text-xs py-0.5">
      <span className={cn('h-1.5 w-1.5 rounded-full shrink-0 mt-[3px]', isFail ? 'bg-destructive' : 'bg-muted')} />
      <span className={cn('min-w-0 flex-1 break-words whitespace-pre-wrap', isFail ? 'text-destructive' : 'text-muted-foreground')}>
        <HT text={body} sc={sc} offset={offset} />
      </span>
    </div>
  )
}

// ── Tool call + result as a paired block ──────────────────────────────────────
function ToolBlock({ use, result, scUse, scResult }: {
  use: LogEntry; result: LogEntry | null
  scUse?: SearchCtx; scResult?: SearchCtx
}) {
  const useText = use.message.trim()
  const { name, detail } = parseTool(useText)
  const color  = toolColor(name)
  const dot    = toolBg(name)

  const resultText = result?.message.trim() ?? ''
  const isError    = result ? classifyLog(resultText) === 'tool-result-error' : false
  const { detail: rDetail, isMultiLine } = result ? parseResult(resultText) : { detail: '', isMultiLine: false }
  const summary = result ? resultSummary(resultText, isError) : ''

  // Search offsets — use
  const nameIdx    = useText.indexOf(name)
  const prefixTxt  = nameIdx >= 0 ? useText.slice(0, nameIdx) : ''
  const nameOff    = scUse ? scUse.logMatchOffset + countMatches(prefixTxt, scUse.query) : 0
  const detailIdx  = detail ? useText.indexOf(detail, nameIdx + name.length) : -1
  const sepTxt     = (detailIdx >= 0 && nameIdx >= 0) ? useText.slice(nameIdx + name.length, detailIdx) : ''
  const detailOff  = nameOff + (scUse ? countMatches(name, scUse.query) + countMatches(sepTxt, scUse.query) : 0)

  // Search offsets — result
  const rDetailIdx = rDetail ? resultText.lastIndexOf(rDetail) : -1
  const rPrefixTxt = rDetailIdx >= 0 ? resultText.slice(0, rDetailIdx) : resultText
  const rDetailOff = scResult ? scResult.logMatchOffset + countMatches(rPrefixTxt, scResult.query) : 0
  const rMatchCount = scResult ? countMatches(resultText, scResult.query) : 0

  // Expand logic: auto-open if search has a match inside
  const [explicitOpen, setExplicitOpen] = useState(false)
  const isExpanded = isMultiLine && (explicitOpen || rMatchCount > 0)

  // Display: for multi-line tool-use (rare), just show first line
  const displayDetail = detail.split('\n')[0]
  // Strip trailing paren annotation for cleanliness
  const parenMatch = displayDetail.match(/^(.+?)(\s+\(.*\))?$/)
  const primary    = parenMatch?.[1] ?? displayDetail

  return (
    <div className="font-mono my-px">
      {/* ── Single-line row ── */}
      <div
        onClick={() => isMultiLine && setExplicitOpen(v => !v)}
        className={cn(
          'group flex items-start gap-0 py-0.5 rounded-sm -mx-1 px-1',
          isMultiLine ? 'cursor-pointer hover:bg-muted/40' : ''
        )}
      >
        {/* Colored dot */}
        <span className={cn('h-1.5 w-1.5 rounded-full shrink-0 mr-2.5 mt-[3px]', dot)} />

        {/* Tool name — fixed column */}
        <span className={cn('text-xs font-semibold shrink-0 w-[88px]', color)}>
          <HT text={name} sc={scUse} offset={nameOff} />
        </span>

        {/* Path / args — wrap instead of truncate */}
        <span className="text-xs text-foreground/80 flex-1 min-w-0 break-words whitespace-pre-wrap">
          <HT text={primary} sc={scUse} offset={detailOff} />
        </span>

        {/* Result summary */}
        {result && (
          <span className={cn(
            'text-xs shrink-0 ml-3 mt-[1px] flex items-center gap-1 tabular-nums',
            isError ? 'text-destructive' : summary.includes('written') ? 'text-success' : 'text-muted-foreground'
          )}>
            <HT text={summary} sc={scResult} offset={rDetailOff} />
            {isMultiLine && (
              <ChevronRight className={cn('h-3.5 w-3.5 transition-transform opacity-40', isExpanded && 'rotate-90')} />
            )}
          </span>
        )}
      </div>

      {/* ── Expanded output ── */}
      {isExpanded && (
        <div className="ml-[52px] mt-2 mb-2 rounded-md border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 max-h-80 overflow-y-auto overflow-x-hidden">
            {rDetail.split('\n').map((ln, i) => {
              const lineText   = ln.startsWith('  ') ? ln.slice(2) : ln
              const prevLines  = rDetail.split('\n').slice(0, i).join('\n') + (i > 0 ? '\n' : '')
              const lineRawOff = scResult ? rDetailOff + countMatches(prevLines, scResult.query) : 0
              const lineOff    = (scResult && ln.startsWith('  ')) ? lineRawOff + countMatches('  ', scResult.query) : lineRawOff
              return (
                <div key={i} className="text-xs text-foreground/80 whitespace-pre-wrap break-words leading-5">
                  <HT text={lineText} sc={scResult} offset={lineOff} />
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Thinking — collapsible ────────────────────────────────────────────────────
function ThinkingBlock({ entry, sc }: { entry: LogEntry; sc?: SearchCtx }) {
  const text   = entry.message.trim()
  const prefix = text.match(/^\[thinking\]\s*/)?.[0] ?? ''
  const body   = text.slice(prefix.length)
  const offset = sc ? sc.logMatchOffset + countMatches(prefix, sc.query) : 0

  const [open, setOpen] = useState(body.length <= 100)
  const hasMatch = sc ? countMatches(body, sc.query) > 0 : false
  const show = open || hasMatch

  return (
    <div className="my-1.5 font-mono">
      <button onClick={() => setOpen(v => !v)}
        className="flex items-start gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-left">
        <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 mt-px transition-transform', show && 'rotate-90')} />
        <span className="italic">
          {!show
            ? <span className="text-muted-foreground/80">{body.slice(0, 80).trimEnd()}{body.length > 80 ? '…' : ''}</span>
            : 'thinking'
          }
        </span>
      </button>
      {show && (
        <div className="mt-1 ml-5 pl-3 border-l border-border text-xs text-muted-foreground whitespace-pre-wrap break-words leading-5 italic min-w-0">
          <HT text={body} sc={sc} offset={offset} />
        </div>
      )}
    </div>
  )
}

// ── Sentinel outcome ──────────────────────────────────────────────────────────
function SentinelBlock({ entry, sc }: { entry: LogEntry; sc?: SearchCtx }) {
  const text = entry.message.trim()
  let parsed: Record<string, unknown> = {}
  try { parsed = JSON.parse(text) } catch { /* */ }

  const status = String(parsed.status ?? '')
  const detail = parsed.reason ? String(parsed.reason)
    : parsed.pr_url ? String(parsed.pr_url) : ''
  const isOk   = status === 'COMPLETED'
  const isFail = status === 'FAILED'

  const statusStart = text.indexOf(status)
  const sPrefixOff  = sc ? sc.logMatchOffset + countMatches(text.slice(0, Math.max(0, statusStart)), sc.query) : 0
  const detailStart = detail ? text.indexOf(detail, statusStart + status.length) : -1
  const detailOff   = (sc && detailStart > -1)
    ? sc.logMatchOffset + countMatches(text.slice(0, detailStart), sc.query)
    : sPrefixOff + (sc ? countMatches(status, sc.query) : 0)

  return (
    <div className={cn(
      'my-4 rounded-md px-4 py-3 border-l-2 font-mono min-w-0',
      isOk   ? 'border-success bg-success/10' :
      isFail ? 'border-destructive bg-destructive/10' :
               'border-warning bg-warning/10'
    )}>
      <div className={cn('text-xs font-bold uppercase tracking-widest',
        isOk ? 'text-success' : isFail ? 'text-destructive' : 'text-warning')}>
        <HT text={status} sc={sc} offset={sPrefixOff} />
      </div>
      {detail && (
        <div className="text-xs text-muted-foreground mt-1.5 break-words whitespace-pre-wrap">
          <HT text={detail} sc={sc} offset={detailOff} />
        </div>
      )}
    </div>
  )
}
