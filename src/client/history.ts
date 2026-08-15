/**
 * Bounded Session-history projection for one task execution round.
 * @module @deepseek-ai/dsh-client-ui-task-board/client/history
 */

import type {
  HistoryEntry,
  IApiClient,
} from '@deepseek-ai/dsh-client-connection/client'
import type { TaskBoardRound } from '../types.ts'

/** Raw non-stream event retained with any Host render intent. */
export interface TaskBoardHistoryEventRow {
  readonly kind: 'event'
  readonly entry: HistoryEntry
}

/** Adjacent assistant chunks coalesced into one readable stream row. */
export interface TaskBoardHistoryAssistantRow {
  readonly kind: 'assistant-stream'
  readonly turn: number
  readonly step: number
  readonly startSeq: number
  readonly endSeq: number
  readonly time: number
  readonly reasoning: string
  readonly text: string
  readonly entries: readonly HistoryEntry[]
}

/** One execution-log presentation row. */
export type TaskBoardHistoryRow = TaskBoardHistoryEventRow | TaskBoardHistoryAssistantRow

/** Completed bounded projection for one task execution round. */
export interface TaskBoardRoundHistory {
  readonly rows: readonly TaskBoardHistoryRow[]
  readonly startSeq: number | undefined
  readonly endSeq: number | undefined
  readonly truncated: boolean
}

/** Pagination and memory bounds for execution-log reads. */
export interface TaskBoardHistoryOptions {
  readonly pageSize?: number
  readonly maxEvents?: number
}

/** Minimal Client API surface required to page one Session history. */
export interface TaskBoardHistoryApi {
  readonly sessions: Pick<IApiClient['sessions'], 'history'>
}

const DEFAULT_PAGE_SIZE = 200
const DEFAULT_MAX_EVENTS = 2_000

function coalesce(entries: readonly HistoryEntry[]): readonly TaskBoardHistoryRow[] {
  const rows: TaskBoardHistoryRow[] = []
  let stream: TaskBoardHistoryAssistantRow | undefined

  const flush = (): void => {
    if (stream === undefined) return
    rows.push(stream)
    stream = undefined
  }

  for (const entry of entries) {
    const event = entry.event
    if (event.type !== 'assistant/chunk') {
      flush()
      rows.push({ kind: 'event', entry })
      continue
    }

    const { turn, step, chunk } = event.data
    if (stream === undefined || stream.turn !== turn || stream.step !== step) {
      flush()
      stream = {
        kind: 'assistant-stream',
        turn,
        step,
        startSeq: event.seq,
        endSeq: event.seq,
        time: event.time,
        reasoning: '',
        text: '',
        entries: [entry],
      }
    } else {
      stream = {
        ...stream,
        endSeq: event.seq,
        entries: [...stream.entries, entry],
      }
    }
    if (chunk.type === 'reasoning-delta') stream = { ...stream, reasoning: stream.reasoning + chunk.text }
    else if (chunk.type === 'text-delta') stream = { ...stream, text: stream.text + chunk.text }
  }
  flush()
  return rows
}

/**
 * Read Session history backward until the round interval is covered.
 * @param api - Client API face used only for `session.history`.
 * @param round - durable task execution round carrying Session and seq bounds.
 * @param signal - optional cancellation signal for dialog teardown.
 * @param options - page and retained-event bounds.
 * @returns oldest-first rows restricted to the round interval.
 */
export async function loadRoundHistory(
  api: TaskBoardHistoryApi,
  round: TaskBoardRound,
  signal?: AbortSignal,
  options: TaskBoardHistoryOptions = {},
): Promise<TaskBoardRoundHistory> {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE
  const maxEvents = options.maxEvents ?? DEFAULT_MAX_EVENTS
  const startSeq = round.startSeq ?? round.prompts[0]?.messageSeq
  const endSeq = round.endSeq
  let beforeSeq: number | undefined
  let retained: HistoryEntry[] = []
  let truncated = false

  while (true) {
    signal?.throwIfAborted()
    const response = await api.sessions.history({
      sessionId: round.sessionId,
      ...(beforeSeq === undefined ? {} : { beforeSeq }),
      maxMessages: pageSize,
    }, signal)
    if (!response.result.ok) {
      throw new Error(`${response.result.error.code}: ${response.result.error.message}`)
    }

    const { events, hasMore } = response.result.value
    const inRange = events.filter(({ event }) =>
      (startSeq === undefined || event.seq >= startSeq)
      && (endSeq === undefined || event.seq <= endSeq))
    retained = [...inRange, ...retained]
    if (retained.length > maxEvents) {
      retained = retained.slice(-maxEvents)
      truncated = true
    }

    const earliest = events[0]?.event.seq
    const intervalCovered = startSeq === undefined
      ? !hasMore
      : earliest !== undefined && earliest <= startSeq
    if (intervalCovered || !hasMore || earliest === undefined || truncated) break
    beforeSeq = earliest
  }

  const unique = [...new Map(retained.map(entry => [entry.event.seq, entry])).values()]
    .sort((left, right) => left.event.seq - right.event.seq)
  return {
    rows: coalesce(unique),
    startSeq,
    endSeq,
    truncated,
  }
}
