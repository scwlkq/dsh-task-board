// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { WorkspaceView } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  TaskBoardRound,
  TaskBoardStatus,
  TaskBoardTask,
  TaskBoardTaskId,
} from '../src/types.ts'
import { TaskDetail } from '../src/client/TaskDetail.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t = makeTranslate(zh)

function round(status: TaskBoardRound['status'] = 'completed'): TaskBoardRound {
  return {
    id: 'round-1' as never,
    ordinal: 1,
    trigger: 'initial',
    status,
    originStatus: 'initialized',
    sessionId: 'session-1' as never,
    prompts: [],
    startedAt: 1,
    ...(status === 'starting' || status === 'running' ? {} : { endedAt: 2 }),
  }
}

function task(status: TaskBoardStatus, overrides: Partial<TaskBoardTask> = {}): TaskBoardTask {
  return {
    id: `task-${status}` as TaskBoardTaskId,
    sequence: 1,
    identifier: 'DSH-1',
    revision: 1,
    title: `${status} task`,
    titleMode: 'manual',
    description: 'Requirement',
    acceptanceCriteria: 'Acceptance',
    status,
    position: 'a',
    attachments: [],
    rounds: [],
    activity: [],
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  }
}

function ok(value: TaskBoardTask) {
  return Promise.resolve({ ok: true as const, value })
}

function rejected(message = 'Operation rejected.') {
  return Promise.resolve({
    ok: false as const,
    error: {
      code: 'invalid-transition' as const,
      status: 'initialized' as const,
      operation: 'test',
      message,
    },
  })
}

const workspaces = [{
  workspaceId: 'workspace-1' as WorkspaceView['workspaceId'],
  title: 'Harness Workspace',
  path: '/repo/harness',
  sessionIds: [],
  createdAt: '2026-08-14T00:00:00.000Z',
  updatedAt: '2026-08-14T00:00:00.000Z',
}] satisfies readonly WorkspaceView[]

function mount(
  current: TaskBoardTask | undefined,
  overrides: Partial<ComponentProps<typeof TaskDetail>> = {},
) {
  const props = {
    task: current,
    pending: false,
    covered: false,
    workspaces,
    t,
    onClose: vi.fn(),
    start: vi.fn(async () => current === undefined ? rejected() : ok(current)),
    edit: vi.fn(async () => current === undefined ? rejected() : ok(current)),
    followup: vi.fn(async () => current === undefined ? rejected() : ok(current)),
    approve: vi.fn(async () => current === undefined ? rejected() : ok(current)),
    reject: vi.fn(async () => current === undefined ? rejected() : ok(current)),
    retry: vi.fn(async () => current === undefined ? rejected() : ok(current)),
    stop: vi.fn(async () => current === undefined ? rejected() : ok(current)),
    reopen: vi.fn(async () => current === undefined ? rejected() : ok(current)),
    remove: vi.fn(async (id: TaskBoardTaskId) => ({
      ok: true as const,
      value: { deleted: true as const, taskId: id },
    })),
    onOpenRound: vi.fn(),
    openSession: vi.fn(),
    ...overrides,
  } satisfies ComponentProps<typeof TaskDetail>
  const view = render(<TaskDetail {...props} />)
  return { props, view }
}

describe('TaskDetail', () => {
  it('renders nothing without a selected task', () => {
    const mounted = mount(undefined)
    expect(mounted.view.container.firstChild).toBeNull()
  })

  it('renders initialized history and routes start, edit, delete, round, and Session actions', async () => {
    const current = task('initialized', {
      description: '',
      acceptanceCriteria: '',
      workspaceId: 'workspace-1' as never,
      agentPreset: 'Backend',
      rounds: [round()],
      activity: [{ id: 'activity-1' as never, at: 1, actor: 'user', operation: 'created' }],
    })
    const start = vi.fn(async () => rejected('Start rejected.'))
    const mounted = mount(current, { start })

    expect(screen.getByText('Harness Workspace')).toBeDefined()
    expect(screen.getByText('Backend')).toBeDefined()
    expect(screen.getByText('创建任务')).toBeDefined()
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2)
    fireEvent.click(screen.getByRole('button', { name: '开始执行' }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('Start rejected.') })

    fireEvent.click(screen.getByRole('button', { name: '查看第 1 轮执行日志' }))
    expect(mounted.props.onOpenRound).toHaveBeenCalledWith('round-1')
    fireEvent.click(screen.getByRole('button', { name: 'session-1' }))
    expect(mounted.props.onClose).toHaveBeenCalledOnce()
    expect(mounted.props.openSession).toHaveBeenCalledWith('session-1')

    fireEvent.click(screen.getByRole('button', { name: '编辑任务' }))
    const editDialog = screen.getByRole('dialog', { name: '编辑 DSH-1' })
    fireEvent.click(within(editDialog).getAllByRole('button', { name: '取消' }).at(-1)!)
    expect(screen.queryByRole('dialog', { name: '编辑 DSH-1' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '编辑任务' }))
    const reopenedEdit = screen.getByRole('dialog', { name: '编辑 DSH-1' })
    fireEvent.click(within(reopenedEdit).getAllByRole('button', { name: '取消' })[0]!)
    expect(screen.queryByRole('dialog', { name: '编辑 DSH-1' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '删除任务' }))
    const deleteDialog = screen.getByRole('dialog', { name: '删除这个任务？' })
    fireEvent.click(within(deleteDialog).getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('dialog', { name: '删除这个任务？' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '关闭任务详情' }))
    expect(mounted.props.onClose).toHaveBeenCalledTimes(2)
  })

  it('runs follow-up, stop, review, reopen, and edit failure flows', async () => {
    const running = task('running', { cwd: '/tmp/project', rounds: [round('starting')] })
    const followup = vi.fn()
      .mockResolvedValueOnce({ ok: true as const, value: running })
      .mockResolvedValueOnce({
        ok: false as const,
        error: { code: 'invalid-transition' as const, status: 'running' as const, operation: 'followup', message: 'Follow-up rejected.' },
      })
    const stop = vi.fn(async () => rejected('Stop rejected.'))
    const mounted = mount(running, { followup, stop })
    const input = screen.getByLabelText<HTMLTextAreaElement>('追加指令')
    const send = screen.getByRole('button', { name: '发送给 Agent' })
    expect((send as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(input, { target: { value: ' Continue ' } })
    fireEvent.click(send)
    await waitFor(() => { expect(input.value).toBe('') })
    expect(followup).toHaveBeenCalledWith(running.id, 'Continue')
    fireEvent.change(input, { target: { value: 'Again' } })
    fireEvent.click(send)
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('Follow-up rejected.') })
    fireEvent.click(screen.getByRole('button', { name: '停止执行' }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('Stop rejected.') })

    const reviewed = task('review')
    const approve = vi.fn(async () => rejected('Approval rejected.'))
    const reject = vi.fn(async () => rejected('Review rejected.'))
    mounted.view.rerender(<TaskDetail {...mounted.props} task={reviewed} approve={approve} reject={reject} />)
    fireEvent.click(screen.getByRole('button', { name: '审核通过' }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('Approval rejected.') })
    const feedback = screen.getByLabelText<HTMLTextAreaElement>('驳回反馈')
    const rejectButton = screen.getByRole('button', { name: '驳回并继续执行' })
    expect((rejectButton as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(feedback, { target: { value: ' Revise this ' } })
    fireEvent.click(rejectButton)
    await waitFor(() => { expect(reject).toHaveBeenCalledWith(reviewed.id, 'Revise this') })

    const done = task('done')
    const reopen = vi.fn(async () => rejected('Reopen rejected.'))
    mounted.view.rerender(<TaskDetail {...mounted.props} task={done} reopen={reopen} />)
    fireEvent.click(screen.getByRole('button', { name: '重新打开' }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('Reopen rejected.') })

    const edit = vi.fn(async () => rejected('Edit rejected.'))
    mounted.view.rerender(<TaskDetail {...mounted.props} task={done} edit={edit} />)
    fireEvent.click(screen.getByRole('button', { name: '编辑任务' }))
    const dialog = screen.getByRole('dialog', { name: '编辑 DSH-1' })
    fireEvent.change(within(dialog).getByLabelText('任务标题'), { target: { value: ' Edited ' } })
    fireEvent.change(within(dialog).getByLabelText('任务要求'), { target: { value: ' Requirement ' } })
    fireEvent.change(within(dialog).getByLabelText('验收标准'), { target: { value: ' Acceptance ' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '保存修改' }))
    await waitFor(() => {
      expect(edit).toHaveBeenCalledWith(done.id, {
        title: 'Edited',
        description: 'Requirement',
        acceptanceCriteria: 'Acceptance',
      })
    })
    expect(screen.getByRole('alert').textContent).toContain('Edit rejected.')
  })

  it('handles retry, fresh Session confirmation, and deletion failures explicitly', async () => {
    const failed = task('failed', { rounds: [], cwd: '/tmp/failed' })
    const ordinaryRetries = [
      { ok: true as const, value: failed },
      {
        ok: false as const,
        error: { code: 'invalid-transition' as const, status: 'failed' as const, operation: 'retry', message: 'Retry rejected.' },
      },
      {
        ok: false as const,
        error: { code: 'fresh-session-required' as const, sessionId: 'session-old' as never },
      },
      {
        ok: false as const,
        error: { code: 'fresh-session-required' as const, sessionId: 'session-old' as never },
      },
      {
        ok: false as const,
        error: { code: 'fresh-session-required' as const, sessionId: 'session-old' as never },
      },
    ]
    const freshRetries = [
      { ok: true as const, value: failed },
      {
        ok: false as const,
        error: { code: 'invalid-transition' as const, status: 'failed' as const, operation: 'retry', message: 'Fresh retry rejected.' },
      },
    ]
    const retry = vi.fn(async (_id: TaskBoardTaskId, allowFresh: boolean) => {
      const result = (allowFresh ? freshRetries : ordinaryRetries).shift()
      if (result === undefined) throw new Error('unexpected retry call')
      return result
    })
    const remove = vi.fn(async () => ({
      ok: false as const,
      error: { code: 'invalid-transition' as const, status: 'failed' as const, operation: 'delete', message: 'Delete rejected.' },
    }))
    mount(failed, { retry, remove })

    expect(screen.getByText('本轮执行未成功完成。')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '人工重试' }))
    await waitFor(() => { expect(retry).toHaveBeenCalledTimes(1) })
    fireEvent.click(screen.getByRole('button', { name: '人工重试' }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('Retry rejected.') })

    fireEvent.click(screen.getByRole('button', { name: '人工重试' }))
    let fresh = await screen.findByRole('dialog', { name: '使用新 Session 重试？' })
    fireEvent.click(within(fresh).getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('dialog', { name: '使用新 Session 重试？' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '人工重试' }))
    fresh = await screen.findByRole('dialog', { name: '使用新 Session 重试？' })
    fireEvent.click(within(fresh).getByRole('checkbox', { name: '我理解新 Session 不包含原会话上下文' }))
    fireEvent.click(within(fresh).getByRole('button', { name: '使用新 Session 重试' }))
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: '使用新 Session 重试？' })).toBeNull() })

    fireEvent.click(screen.getByRole('button', { name: '人工重试' }))
    fresh = await screen.findByRole('dialog', { name: '使用新 Session 重试？' })
    fireEvent.click(within(fresh).getByRole('checkbox', { name: '我理解新 Session 不包含原会话上下文' }))
    fireEvent.click(within(fresh).getByRole('button', { name: '使用新 Session 重试' }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('Fresh retry rejected.') })

    fireEvent.click(screen.getByRole('button', { name: '删除任务' }))
    const deletion = screen.getByRole('dialog', { name: '删除这个任务？' })
    fireEvent.click(within(deletion).getByRole('checkbox', { name: '我理解任务卡将被永久删除' }))
    fireEvent.click(within(deletion).getByRole('button', { name: '确认删除' }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('Delete rejected.') })
  })
})
