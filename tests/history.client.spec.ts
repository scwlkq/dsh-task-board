import { describe, expect, it, vi } from 'vitest'
import type {
  SessionHistoryRecord,
  SessionPageRequest,
  SessionWireEvent,
} from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TaskBoardRound, TaskBoardRoundId } from '../src/types.ts'
import { loadRoundHistory, type TaskBoardHistoryApi } from '../src/client/history.ts'

function entry(event: SessionWireEvent): SessionHistoryRecord {
  return { type: 'event', event }
}

function boundary(seq: number, type: 'turn/start' | 'turn/end'): SessionHistoryRecord {
  return entry(type === 'turn/start'
    ? { type, seq, time: seq, data: { turn: 1 } }
    : { type, seq, time: seq, data: { turn: 1, reason: { kind: 'completed' } } })
}

function chunk(seq: number, type: 'text-delta' | 'reasoning-delta', text: string): SessionHistoryRecord {
  return entry({
    type: 'assistant/chunk',
    seq,
    time: seq,
    data: { turn: 1, step: 1, chunk: { type, index: type === 'text-delta' ? 1 : 0, text } },
  })
}

function toolChunk(seq: number): SessionHistoryRecord {
  return entry({
    type: 'assistant/chunk',
    seq,
    time: seq,
    data: {
      turn: 1,
      step: 1,
      chunk: {
        type: 'tool-call-delta',
        index: 2,
        id: 'call-1' as never,
        argumentsDelta: '{}',
      },
    },
  })
}

function round(overrides: Partial<TaskBoardRound> = {}): TaskBoardRound {
  return {
    id: 'round-1' as TaskBoardRoundId,
    ordinal: 1,
    trigger: 'initial',
    status: 'completed',
    originStatus: 'initialized',
    sessionId: 'session-1' as SessionId,
    prompts: [],
    startSeq: 3,
    endSeq: 8,
    startedAt: 3,
    endedAt: 8,
    ...overrides,
  }
}

function roundWithoutSequence(overrides: Partial<TaskBoardRound> = {}): TaskBoardRound {
  const { startSeq: _startSeq, endSeq: _endSeq, ...value } = round(overrides)
  return value
}

function api(pages: readonly {
  readonly records: readonly SessionHistoryRecord[]
  readonly hasMore: boolean
}[]) {
  let index = 0
  const page = vi.fn(async () => {
    const value = pages[index++] ?? { records: [], hasMore: false }
    return {
      ok: true as const,
      value: { records: [...value.records], hasMore: value.hasMore },
    }
  })
  return { page, client: { session: { page } } satisfies TaskBoardHistoryApi }
}

describe('loadRoundHistory', () => {
  it('pages backward to the round start and excludes surrounding turns', async () => {
    const source = api([
      { records: [boundary(6, 'turn/start'), boundary(7, 'turn/end'), boundary(8, 'turn/end'), boundary(9, 'turn/start')], hasMore: true },
      { records: [boundary(2, 'turn/end'), boundary(3, 'turn/start'), boundary(4, 'turn/start'), boundary(5, 'turn/end')], hasMore: true },
    ])

    const result = await loadRoundHistory(source.client, round(), undefined, { pageSize: 4, maxEvents: 20 })

    expect(source.page).toHaveBeenNthCalledWith(1, {
      address: { kind: 'session', sessionId: 'session-1' },
      throughSeq: 8,
      maxMessages: 4,
    }, undefined)
    expect(source.page).toHaveBeenNthCalledWith(2, {
      address: { kind: 'session', sessionId: 'session-1' },
      throughSeq: 8,
      beforeSeq: 6,
      maxMessages: 4,
    }, undefined)
    expect(result.rows.flatMap(row => row.kind === 'event' ? [row.entry.event.seq] : [row.startSeq, row.endSeq])).toEqual([
      3, 4, 5, 6, 7, 8,
    ])
    expect(result).toMatchObject({ startSeq: 3, endSeq: 8, truncated: false })
  })

  it('coalesces adjacent assistant deltas without dropping reasoning', async () => {
    const source = api([{ records: [
      boundary(3, 'turn/start'),
      chunk(4, 'reasoning-delta', 'think '),
      chunk(5, 'reasoning-delta', 'again'),
      chunk(6, 'text-delta', 'answer '),
      chunk(7, 'text-delta', 'done'),
      boundary(8, 'turn/end'),
    ], hasMore: false }])

    const result = await loadRoundHistory(source.client, round(), undefined, { pageSize: 20, maxEvents: 20 })

    expect(result.rows).toHaveLength(3)
    expect(result.rows[0]).toMatchObject({ kind: 'event', entry: { event: { seq: 3 } } })
    expect(result.rows[1]).toMatchObject({
      kind: 'assistant-stream',
      startSeq: 4,
      endSeq: 7,
      reasoning: 'think again',
      text: 'answer done',
    })
    expect(result.rows[2]).toMatchObject({ kind: 'event', entry: { event: { seq: 8 } } })
  })

  it('retains non-text assistant chunks in the stream evidence', async () => {
    const source = api([{ records: [
      boundary(3, 'turn/start'),
      toolChunk(4),
      boundary(5, 'turn/end'),
    ], hasMore: false }])

    const result = await loadRoundHistory(source.client, round({ endSeq: 5 }))

    expect(result.rows[1]).toMatchObject({
      kind: 'assistant-stream',
      reasoning: '',
      text: '',
      entries: [{ event: { seq: 4 } }],
    })
  })

  it('uses the first admitted prompt when the round start sequence is absent', async () => {
    const source = api([{ records: [boundary(3, 'turn/start'), boundary(4, 'turn/end')], hasMore: false }])
    const result = await loadRoundHistory(source.client, roundWithoutSequence({
      prompts: [{
        id: 'prompt-1' as never,
        rpcId: 'rpc-1' as never,
        kind: 'initial',
        text: 'Prompt',
        acceptedAt: 1,
        messageSeq: 4,
      }],
    }))

    expect(result.startSeq).toBe(4)
    expect(result.rows.map(row => row.kind === 'event' ? row.entry.event.seq : row.startSeq)).toEqual([4])
  })

  it('loads one unbounded page when no round sequence evidence exists', async () => {
    const source = api([{ records: [boundary(1, 'turn/start')], hasMore: false }])
    const result = await loadRoundHistory(source.client, roundWithoutSequence())

    expect(source.page).toHaveBeenCalledOnce()
    expect(result).toMatchObject({ startSeq: undefined, endSeq: undefined, truncated: false })
  })

  it('surfaces Session history API failures', async () => {
    const page = vi.fn(async () => ({
      ok: false as const,
      error: {
        code: 'session-not-found',
        message: 'Session is unavailable.',
        details: { sessionId: 'session-1' as SessionId },
      },
    }))

    await expect(loadRoundHistory({ session: { page } }, round())).rejects.toThrow(
      'session-not-found: Session is unavailable.',
    )
  })

  it('caps loaded events and marks the projection truncated', async () => {
    const source = api([{ records: [
      boundary(3, 'turn/start'),
      boundary(4, 'turn/start'),
      boundary(5, 'turn/start'),
      boundary(6, 'turn/start'),
      boundary(7, 'turn/start'),
      boundary(8, 'turn/end'),
    ], hasMore: true }])

    const result = await loadRoundHistory(source.client, round(), undefined, { pageSize: 20, maxEvents: 3 })

    expect(result.truncated).toBe(true)
    expect(result.rows).toHaveLength(3)
    expect(result.rows.map(row => row.kind === 'event' ? row.entry.event.seq : row.startSeq)).toEqual([6, 7, 8])
  })

  it('passes cancellation to every page and aborts before another request', async () => {
    const controller = new AbortController()
    const page = vi.fn(async (_request: SessionPageRequest, signal?: AbortSignal) => {
      controller.abort()
      signal?.throwIfAborted()
      return {
        ok: true as const,
        value: { records: [], hasMore: false },
      }
    })

    await expect(loadRoundHistory({ session: { page } } satisfies TaskBoardHistoryApi, round(), controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' })
    expect(page).toHaveBeenCalledOnce()
  })
})
