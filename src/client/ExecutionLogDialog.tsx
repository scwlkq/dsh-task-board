/** Virtualized execution-log dialog for one task round. */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  Button,
  DiffBlock,
  JsonTree,
  Modal,
  TerminalBlock,
  writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { HistoryEntry } from '@deepseek-ai/dsh-client-connection/client'
import type {
  TaskBoardRound,
  TaskBoardTask,
  TaskBoardTaskId,
} from '../types.ts'
import type { TaskBoardClientResult } from './controller.ts'
import type {
  TaskBoardHistoryRow,
  TaskBoardRoundHistory,
} from './history.ts'
import type { TaskBoardOverlayProps } from './slots.ts'
import css from './ExecutionLogDialog.module.css'

type LogFilter = 'all' | 'agent' | 'tools' | 'errors'
type LogOrder = 'oldest' | 'newest'

interface ExecutionLogDialogProps {
  readonly task: TaskBoardTask
  readonly round: TaskBoardRound
  readonly t: TaskBoardOverlayProps['t']
  readonly load: (round: TaskBoardRound, signal?: AbortSignal) => Promise<TaskBoardRoundHistory>
  readonly stop: (taskId: TaskBoardTaskId) => Promise<TaskBoardClientResult<TaskBoardTask>>
  readonly onClose: () => void
}

function rowSeq(row: TaskBoardHistoryRow): readonly [number, number] {
  return row.kind === 'event'
    ? [row.entry.event.seq, row.entry.event.seq]
    : [row.startSeq, row.endSeq]
}

function rowMatches(row: TaskBoardHistoryRow, filter: LogFilter): boolean {
  if (filter === 'all') return true
  if (row.kind === 'assistant-stream') return filter === 'agent'
  const type = row.entry.event.type
  if (filter === 'agent') return type === 'assistant/message'
  if (filter === 'tools') return type === 'tool/call' || type === 'tool/result'
  return type === 'turn/end' || (type === 'tool/result' && row.entry.event.data.error !== undefined)
}

function contentText(entry: HistoryEntry): string | undefined {
  const event = entry.event
  const content = event.type === 'user/message'
    ? event.data.content
    : event.type === 'assistant/message'
      ? event.data.message.content
      : undefined
  if (content === undefined) return undefined
  const text = content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
  return text === '' ? undefined : text
}

function renderIntent(entry: HistoryEntry): React.ReactNode {
  const intent = entry.view
  if (intent === undefined) return null
  if (intent.for === 'call') {
    const view = intent.view
    if (view.card === 'terminal') return <TerminalBlock command={view.title} cwd={view.cwd} running />
    if (view.card === 'diff') return <DiffBlock diffs={view.diffs} />
    return null
  }
  const view = intent.view
  if (view.card === 'terminal') {
    return <TerminalBlock command={view.title ?? 'command'} output={view.output} exitCode={view.exitCode} signal={view.signal} />
  }
  if (view.card === 'diff') return <DiffBlock diffs={view.diffs} />
  return null
}

function EventRow({ row, t }: { readonly row: TaskBoardHistoryRow; readonly t: TaskBoardOverlayProps['t'] }) {
  const [start, end] = rowSeq(row)
  if (row.kind === 'assistant-stream') {
    return (
      <article className={css.row} data-kind="agent">
        <header><strong>{t('log.answer')}</strong><span>#{start}–{end}</span></header>
        {row.reasoning === '' ? null : <details><summary>{t('log.reasoning')}</summary><pre>{row.reasoning}</pre></details>}
        {row.text === '' ? null : <p className={css.agentText}>{row.text}</p>}
      </article>
    )
  }

  const entry = row.entry
  const text = contentText(entry)
  const intent = renderIntent(entry)
  return (
    <article className={css.row} data-kind={entry.event.type}>
      <header>
        <strong>{entry.event.type}</strong>
        <span>#{start}</span>
        <time>{new Date(entry.event.time).toLocaleTimeString()}</time>
      </header>
      {text === undefined ? null : <p className={css.messageText}>{text}</p>}
      {intent}
      {text === undefined && intent === null
        ? <JsonTree data={entry.event.data} label={`${entry.event.type} data`} />
        : null}
    </article>
  )
}

function copyText(history: TaskBoardRoundHistory): string {
  return history.rows.map((row) => {
    if (row.kind === 'assistant-stream') {
      return [`#${row.startSeq}-${row.endSeq} assistant`, row.reasoning, row.text].filter(Boolean).join('\n')
    }
    return `#${row.entry.event.seq} ${row.entry.event.type}\n${JSON.stringify(row.entry.event.data, null, 2)}`
  }).join('\n\n')
}

/**
 * Load and render one round's exact Session sequence interval.
 * @param props - task, round, loader, and active-round stop action.
 * @returns large execution-log modal.
 */
export function ExecutionLogDialog({
  task,
  round,
  t,
  load,
  stop,
  onClose,
}: ExecutionLogDialogProps) {
  const [history, setHistory] = useState<TaskBoardRoundHistory | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<LogFilter>('all')
  const [order, setOrder] = useState<LogOrder>('oldest')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const controller = new AbortController()
    setHistory(null)
    setError(null)
    void load(round, controller.signal).then(setHistory, (reason: unknown) => {
      if (controller.signal.aborted) return
      setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { controller.abort() }
  }, [load, round])

  const filtered = useMemo(() => {
    const rows = history?.rows.filter(row => rowMatches(row, filter)) ?? []
    return order === 'oldest' ? rows : [...rows].reverse()
  }, [filter, history, order])
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 120,
    overscan: 6,
    initialRect: { width: 820, height: 520 },
  })
  const virtualItems = virtualizer.getVirtualItems()
  const active = round.status === 'starting' || round.status === 'running'
  const duration = (round.endedAt ?? Date.now()) - round.startedAt
  const seqStart = history?.startSeq ?? round.startSeq ?? '—'
  const seqEnd = history?.endSeq ?? round.endSeq ?? '…'

  return (
    <Modal
      open
      onClose={onClose}
      title={t('log.title', { identifier: task.identifier, ordinal: round.ordinal })}
      closeLabel={t('log.close')}
      className={css.dialog as string}
      contentClassName={css.content as string}
    >
      <div className={css.meta}>
        <span><small>{t('log.trigger')}</small>{round.trigger}</span>
        <span><small>{t('log.status')}</small>{round.status}</span>
        <span><small>{t('log.session')}</small>{round.sessionId}</span>
        <span><small>{t('log.duration')}</small>{Math.max(0, Math.round(duration / 1_000))}s</span>
        <strong>{t('log.seq', { start: seqStart, end: seqEnd })}</strong>
      </div>
      <div className={css.toolbar}>
        <select aria-label={t('log.filter')} value={filter} onChange={(event) => { setFilter(event.currentTarget.value as LogFilter) }}>
          <option value="all">{t('log.filter.all')}</option>
          <option value="agent">{t('log.filter.agent')}</option>
          <option value="tools">{t('log.filter.tools')}</option>
          <option value="errors">{t('log.filter.errors')}</option>
        </select>
        <button type="button" onClick={() => { setOrder(value => value === 'oldest' ? 'newest' : 'oldest') }}>
          {t(order === 'oldest' ? 'log.order.oldest' : 'log.order.newest')}
        </button>
        <button
          type="button"
          disabled={history === null}
          onClick={history === null ? undefined : () => { void writeClipboard(copyText(history)) }}
        >
          {t('log.copy')}
        </button>
        {active ? <Button size="sm" variant="outline" onClick={() => { void stop(task.id) }}>{t('detail.stop')}</Button> : null}
      </div>

      {history?.truncated === true ? <div className={css.truncated} role="status">{t('log.truncated')}</div> : null}
      {error !== null ? <div className={css.failure} role="alert"><strong>{t('log.error')}</strong><span>{error}</span></div> : null}
      {history === null && error === null ? <p className={css.loading}>{t('log.loading')}</p> : null}
      {history !== null && filtered.length === 0 ? <p className={css.loading}>{t('log.empty')}</p> : null}
      {filtered.length > 0
        ? (
          <div ref={scrollRef} className={css.log}>
            <div className={css.virtual} style={{ height: virtualizer.getTotalSize() }}>
              {virtualItems.length === 0
                ? (
                  <div className={css.fallbackRows}>
                    {filtered.slice(0, 20).map((row) => {
                      const [start, end] = rowSeq(row)
                      return <EventRow key={`${start}:${end}`} row={row} t={t} />
                    })}
                  </div>
                )
                : virtualItems.map((item) => {
                  const row = filtered[item.index]
                  /* v8 ignore next -- TanStack Virtual bounds item indices to the configured count */
                  if (row === undefined) return null
                  return (
                    <div
                      key={item.key}
                      ref={virtualizer.measureElement}
                      data-index={item.index}
                      className={css.virtualRow}
                      style={{ transform: `translateY(${item.start}px)` }}
                    >
                      <EventRow row={row} t={t} />
                    </div>
                  )
                })}
            </div>
          </div>
        )
        : null}
    </Modal>
  )
}
