/**
 * Bounded Session-history projection for one task execution round.
 * @module @deepseek-ai/dsh-client-ui-task-board/client/history
 */

import type { SessionHistoryRecord, SessionPage, SessionPageRequest } from '@deepseek-ai/dsh-api-session-controller/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TaskBoardRound } from '../types.ts'

/** Raw non-stream event retained with any Host render intent. */
export interface TaskBoardHistoryEventRow {
  readonly kind: 'event'
  readonly entry: SessionHistoryRecord
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
  readonly entries: readonly SessionHistoryRecord[]
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

/** Minimal Client Remote surface required to page one Session history. */
export interface TaskBoardHistoryApi {
  readonly session: {
    page: (request: SessionPageRequest, signal?: AbortSignal) => Promise<RemoteResult<SessionPage>>
  }
}

const DEFAULT_PAGE_SIZE = 200
const DEFAULT_MAX_EVENTS = 2_000

function coalesce(entries: readonly SessionHistoryRecord[]): readonly TaskBoardHistoryRow[] {
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

    const data = event.data as { turn: number; step: number; chunk: { type: string; text?: string } }
    const { turn, step, chunk } = data
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
    if (chunk.type === 'reasoning-delta') stream = { ...stream, reasoning: stream.reasoning + (chunk.text ?? '') }
    else if (chunk.type === 'text-delta') stream = { ...stream, text: stream.text + (chunk.text ?? '') }
  }
  flush()
  return rows
}

/**
 * Read Session history backward until the round interval is covered.
 * @param api - Client Remote face used only for `session.page`.
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
  const sessionId: SessionId = round.sessionId
  const startSeq = round.startSeq ?? round.prompts[0]?.messageSeq
  const endSeq = round.endSeq
  // `throughSeq` is the inclusive log cut from the follow opening frame; the
  // wire sentinel `-1` means "read to the end of the log" (see
  // dsh-api-session-controller's page validation). Use it when the round has
  // no closing frame, never Number.MAX_SAFE_INTEGER (a real but absent seq
  // is rejected as "session log does not contain through seq").
  const throughSeq = endSeq ?? -1
  let beforeSeq: number | undefined
  let retained: SessionHistoryRecord[] = []
  let truncated = false

  while (true) {
    signal?.throwIfAborted()
    const response = await api.session.page({
      address: { kind: 'session', sessionId },
      throughSeq,
      ...(beforeSeq === undefined ? {} : { beforeSeq }),
      maxMessages: pageSize,
    }, signal)
    if (!response.ok) {
      throw new Error(`${response.error.code}: ${response.error.message}`)
    }

    const { records, hasMore } = response.value
    const inRange = records.filter(({ event }) =>
      (startSeq === undefined || event.seq >= startSeq)
      && (endSeq === undefined || event.seq <= endSeq))
    retained = [...inRange, ...retained]
    if (retained.length > maxEvents) {
      retained = retained.slice(-maxEvents)
      truncated = true
    }

    const earliest = records[0]?.event.seq
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
