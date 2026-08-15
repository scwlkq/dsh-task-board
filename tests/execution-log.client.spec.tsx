// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { HistoryEntry } from '@deepseek-ai/dsh-client-connection/client'
import type {
  TaskBoardRound,
  TaskBoardRoundId,
  TaskBoardTask,
  TaskBoardTaskId,
} from '../src/types.ts'
import { ExecutionLogDialog } from '../src/client/ExecutionLogDialog.tsx'
import type { TaskBoardHistoryRow, TaskBoardRoundHistory } from '../src/client/history.ts'
import { zh } from '../src/client/locales.ts'
import type { TaskBoardOverlayProps } from '../src/client/slots.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  Reflect.deleteProperty(navigator, 'clipboard')
})

const t: TaskBoardOverlayProps['t'] = makeTranslate(zh)

function round(status: TaskBoardRound['status'] = 'running'): TaskBoardRound {
  return {
    id: 'round-1' as TaskBoardRoundId,
    ordinal: 1,
    trigger: 'initial',
    status,
    originStatus: 'initialized',
    sessionId: 'session-1' as SessionId,
    prompts: [],
    startSeq: 3,
    ...status === 'running' ? {} : { endSeq: 9 },
    startedAt: 1,
  }
}

function task(currentRound: TaskBoardRound): TaskBoardTask {
  return {
    id: 'task-1' as TaskBoardTaskId,
    sequence: 1,
    identifier: 'DSH-1',
    revision: 1,
    title: '实现任务面板',
    titleMode: 'manual',
    description: 'Requirement',
    acceptanceCriteria: 'Acceptance',
    status: currentRound.status === 'running' ? 'running' : 'review',
    position: 'a',
    attachments: [],
    currentSessionId: currentRound.sessionId,
    rounds: [currentRound],
    activity: [],
    createdAt: 1,
    updatedAt: 2,
  }
}

function eventRow(
  seq: number,
  type: string,
  data: unknown,
  view?: HistoryEntry['view'],
): TaskBoardHistoryRow {
  return {
    kind: 'event',
    entry: {
      event: { type, seq, time: seq, data } as HistoryEntry['event'],
      ...(view === undefined ? {} : { view }),
    },
  }
}

const HISTORY: TaskBoardRoundHistory = {
  startSeq: 3,
  endSeq: 9,
  truncated: false,
  rows: [
    {
      kind: 'event',
      entry: { event: { type: 'turn/start', seq: 3, time: 3, data: { turn: 1 } } },
    },
    {
      kind: 'assistant-stream',
      turn: 1,
      step: 1,
      startSeq: 4,
      endSeq: 5,
      time: 4,
      reasoning: '先分析依赖',
      text: '已经完成实现',
      entries: [],
    },
    {
      kind: 'event',
      entry: {
        event: {
          type: 'tool/call',
          seq: 6,
          time: 6,
          data: { turn: 1, step: 1, callId: 'call-1' as never, name: 'bash', arguments: '{"cmd":"pnpm test"}' },
        },
        view: { for: 'call', view: { card: 'terminal', title: 'pnpm test', cwd: '/repo' } },
      },
    },
  ],
}

const RICH_HISTORY: TaskBoardRoundHistory = {
  startSeq: 10,
  endSeq: 20,
  truncated: true,
  rows: [
    {
      kind: 'assistant-stream',
      turn: 1,
      step: 1,
      startSeq: 10,
      endSeq: 10,
      time: 10,
      reasoning: '',
      text: '',
      entries: [],
    },
    eventRow(11, 'user/message', {
      id: 'user-1',
      role: 'user',
      content: [
        { type: 'text', text: 'User request' },
        { type: 'reasoning', text: 'not displayed as message text' },
      ],
      source: { kind: 'user' },
    }),
    eventRow(12, 'assistant/message', {
      turn: 1,
      step: 1,
      message: {
        id: 'assistant-1',
        role: 'assistant',
        content: [{ type: 'text', text: 'Assistant event' }],
        source: { kind: 'model', provider: 'deepseek', model: 'chat' },
      },
    }),
    eventRow(13, 'assistant/message', {
      turn: 1,
      step: 1,
      message: {
        id: 'assistant-2',
        role: 'assistant',
        content: [{ type: 'reasoning', text: 'reasoning-only message' }],
        source: { kind: 'model', provider: 'deepseek', model: 'chat' },
      },
    }),
    eventRow(
      14,
      'tool/call',
      { turn: 1, step: 1, callId: 'call-generic', name: 'generic', arguments: '{}' },
      { for: 'call', view: { card: 'generic', title: 'Generic call' } },
    ),
    eventRow(
      15,
      'tool/call',
      { turn: 1, step: 1, callId: 'call-diff', name: 'write', arguments: '{}' },
      {
        for: 'call',
        view: {
          card: 'diff',
          title: 'Write file',
          diffs: [{ path: 'call.txt', oldText: null, newText: 'call' }],
        },
      },
    ),
    eventRow(
      16,
      'tool/result',
      { turn: 1, step: 1, message: {}, error: { name: 'Error', code: 'FAILED' } },
      { for: 'result', view: { card: 'terminal', output: 'failed output', exitCode: 1 } },
    ),
    eventRow(
      17,
      'tool/result',
      { turn: 1, step: 1, message: {} },
      { for: 'result', view: { card: 'terminal', title: 'named command', output: 'ok', exitCode: 0 } },
    ),
    eventRow(
      18,
      'tool/result',
      { turn: 1, step: 1, message: {} },
      {
        for: 'result',
        view: {
          card: 'diff',
          diffs: [{ path: 'result.txt', oldText: 'before', newText: 'after' }],
        },
      },
    ),
    eventRow(
      19,
      'tool/result',
      { turn: 1, step: 1, message: {} },
      { for: 'result', view: { card: 'generic', title: 'Generic result' } },
    ),
    eventRow(20, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
  ],
}

describe('ExecutionLogDialog', () => {
  it('loads bounded history, renders metadata and Host render intent, and filters focus rows', async () => {
    const currentRound = round()
    const load = vi.fn(async () => HISTORY)
    render(
      <ExecutionLogDialog
        task={task(currentRound)}
        round={currentRound}
        t={t}
        load={load}
        stop={vi.fn(async () => ({ ok: true as const, value: task(currentRound) }))}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByRole('dialog', { name: '执行日志 · DSH-1 · 第 1 轮' })).toBeDefined()
    await waitFor(() => { expect(load).toHaveBeenCalledOnce() })
    expect(await screen.findByText('已经完成实现')).toBeDefined()
    expect(screen.getByText('pnpm test')).toBeDefined()
    expect(screen.getByText('Seq 3–9')).toBeDefined()

    fireEvent.change(screen.getByRole('combobox', { name: '日志筛选' }), { target: { value: 'agent' } })
    expect(screen.getByText('已经完成实现')).toBeDefined()
    expect(screen.queryByText('turn/start')).toBeNull()
  })

  it('renders event variants, filters, reorders, copies, and reports truncation', async () => {
    const currentRound = round('completed')
    const writeText = vi.fn(async (_text: string) => undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    render(
      <ExecutionLogDialog
        task={task(currentRound)}
        round={currentRound}
        t={t}
        load={vi.fn(async () => RICH_HISTORY)}
        stop={vi.fn(async () => ({ ok: true as const, value: task(currentRound) }))}
        onClose={vi.fn()}
      />,
    )

    const copy = screen.getByRole<HTMLButtonElement>('button', { name: '复制全部' })
    expect(copy.disabled).toBe(true)
    expect(await screen.findByText('User request')).toBeDefined()
    expect(screen.getByText('Assistant event')).toBeDefined()
    expect(screen.getByText('日志超过显示上限，仅保留此轮次最近的事件。')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: '最早优先' }))
    expect(screen.getByRole('button', { name: '最新优先' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '最新优先' }))
    expect(screen.getByRole('button', { name: '最早优先' })).toBeDefined()

    const filter = screen.getByRole('combobox', { name: '日志筛选' })
    fireEvent.change(filter, { target: { value: 'agent' } })
    expect(screen.getByText('Assistant event')).toBeDefined()
    expect(screen.queryByText('User request')).toBeNull()

    fireEvent.change(filter, { target: { value: 'tools' } })
    expect(await screen.findByText('named command')).toBeDefined()
    expect(screen.getByText('failed output')).toBeDefined()

    fireEvent.change(filter, { target: { value: 'errors' } })
    expect(await screen.findByText('turn/end')).toBeDefined()
    expect(screen.getByText('failed output')).toBeDefined()
    expect(screen.queryByText('named command')).toBeNull()

    fireEvent.click(copy)
    await waitFor(() => { expect(writeText).toHaveBeenCalledOnce() })
    expect(writeText.mock.calls[0]?.[0]).toContain('#10-10 assistant')
    expect(writeText.mock.calls[0]?.[0]).toContain('#20 turn/end')
  })

  it('reports load failures, renders an empty result, and ignores an aborted rejection', async () => {
    const noSeqRound = { ...round() }
    Reflect.deleteProperty(noSeqRound, 'startSeq')
    const failed = vi.fn(async (): Promise<TaskBoardRoundHistory> => {
      throw new Error('History unavailable')
    })
    const view = render(
      <ExecutionLogDialog
        task={task(noSeqRound)}
        round={noSeqRound}
        t={t}
        load={failed}
        stop={vi.fn(async () => ({ ok: true as const, value: task(noSeqRound) }))}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText('Seq —–…')).toBeDefined()
    expect(await screen.findByText('History unavailable')).toBeDefined()

    const failedWithString = vi.fn(() => Promise.reject('History string failure'))
    view.rerender(
      <ExecutionLogDialog
        task={task(noSeqRound)}
        round={noSeqRound}
        t={t}
        load={failedWithString}
        stop={vi.fn(async () => ({ ok: true as const, value: task(noSeqRound) }))}
        onClose={vi.fn()}
      />,
    )
    expect(await screen.findByText('History string failure')).toBeDefined()

    const emptyHistory: TaskBoardRoundHistory = {
      startSeq: undefined,
      endSeq: undefined,
      truncated: false,
      rows: [],
    }
    view.rerender(
      <ExecutionLogDialog
        task={task(noSeqRound)}
        round={noSeqRound}
        t={t}
        load={vi.fn(async () => emptyHistory)}
        stop={vi.fn(async () => ({ ok: true as const, value: task(noSeqRound) }))}
        onClose={vi.fn()}
      />,
    )
    expect(await screen.findByText('此轮次没有可显示的日志。')).toBeDefined()
    view.unmount()

    let reject!: (reason: unknown) => void
    const pending = new Promise<TaskBoardRoundHistory>((_resolve, rejectPromise) => {
      reject = rejectPromise
    })
    const pendingLoad = vi.fn((_round: TaskBoardRound, _signal?: AbortSignal) => pending)
    const pendingView = render(
      <ExecutionLogDialog
        task={task(noSeqRound)}
        round={noSeqRound}
        t={t}
        load={pendingLoad}
        stop={vi.fn(async () => ({ ok: true as const, value: task(noSeqRound) }))}
        onClose={vi.fn()}
      />,
    )
    await waitFor(() => { expect(pendingLoad).toHaveBeenCalledOnce() })
    const signal = pendingLoad.mock.calls[0]?.[1]
    pendingView.unmount()
    expect(signal?.aborted).toBe(true)
    await act(async () => {
      reject(new Error('late rejection'))
      await pending.catch(() => undefined)
    })
  })

  it('offers stop only for an active round', async () => {
    const currentRound = round('running')
    const stop = vi.fn(async () => ({ ok: true as const, value: task(currentRound) }))
    const view = render(
      <ExecutionLogDialog
        task={task(currentRound)}
        round={currentRound}
        t={t}
        load={vi.fn(async () => HISTORY)}
        stop={stop}
        onClose={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '停止执行' }))
    await waitFor(() => { expect(stop).toHaveBeenCalledWith('task-1') })

    view.rerender(
      <ExecutionLogDialog task={task(round('completed'))} round={round('completed')} t={t} load={vi.fn(async () => HISTORY)} stop={stop} onClose={vi.fn()} />,
    )
    expect(screen.queryByRole('button', { name: '停止执行' })).toBeNull()
  })
})
