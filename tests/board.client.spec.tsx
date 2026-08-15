// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import {
  createSnapshotStore,
  type SessionListState,
  type WorkspaceId,
  type WorkspaceListState,
} from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type {
  TaskBoardCreateRequest,
  TaskBoardRound,
  TaskBoardStatus,
  TaskBoardTask,
  TaskBoardTaskId,
} from '../src/types.ts'
import type { TaskBoardClientView } from '../src/client/controller.ts'
import { resolveTaskDrop, TASK_BOARD_COLUMN_PREFIX } from '../src/client/drag.ts'
import { zh } from '../src/client/locales.ts'
import { createTaskBoardStore } from '../src/client/store.ts'
import { TaskBoardOverlay } from '../src/client/TaskBoardOverlay.tsx'
import type { TaskBoardOverlayProps } from '../src/client/slots.ts'

afterEach(cleanup)

const t: TaskBoardOverlayProps['t'] = makeTranslate(zh)

function task(
  id: string,
  status: TaskBoardStatus,
  position: string,
  overrides: Partial<TaskBoardTask> = {},
): TaskBoardTask {
  const sequence = Number(id.replace(/\D/g, '')) || 1
  return {
    id: id as TaskBoardTaskId,
    sequence,
    identifier: `DSH-${sequence}`,
    revision: 1,
    title: `Task ${sequence}`,
    titleMode: 'manual',
    description: `Requirement ${sequence}`,
    acceptanceCriteria: `Acceptance ${sequence}`,
    status,
    position,
    attachments: [],
    rounds: [],
    activity: [],
    createdAt: sequence,
    updatedAt: sequence,
    ...overrides,
  }
}

const TASKS: readonly TaskBoardTask[] = [
  task('task-1', 'initialized', 'a', { title: '规划 API 网关' }),
  task('task-2', 'running', 'a', { title: '实现认证流程', agentPreset: 'Backend' }),
  task('task-3', 'review', 'a', { title: '审核部署脚本' }),
  task('task-4', 'done', 'a', { title: '完成文档' }),
  task('task-5', 'failed', 'a', {
    title: '修复上传失败',
    lastStartFailure: {
      stage: 'execution',
      code: 'provider-error',
      message: '模型服务暂时不可用',
    },
  }),
]

function emptySessions() {
  const store = createSnapshotStore<SessionListState>({
    ids: [],
    byId: {},
    current: undefined,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  })
  return bindSnapshotSelector(store)
}

function workspaces() {
  const store = createSnapshotStore<WorkspaceListState>({
    items: [{
      workspaceId: 'workspace-1' as WorkspaceId,
      title: 'Harness',
      path: '/repo/harness',
      sessionIds: [],
      createdAt: '2026-08-14T00:00:00.000Z',
      updatedAt: '2026-08-14T00:00:00.000Z',
    }],
    archivedSessionIds: [],
    state: 'idle',
    phase: 'ready',
    error: null,
    baselinesReady: true,
    recentWorkspaceId: 'workspace-1' as WorkspaceId,
  })
  return bindSnapshotSelector(store)
}

function success<T>(value: T) {
  return Promise.resolve({ ok: true as const, value })
}

function mount(
  tasks: readonly TaskBoardTask[] = TASKS,
  overrides: Partial<TaskBoardOverlayProps> = {},
  boardOverrides: Partial<TaskBoardClientView> = {},
) {
  const ui = createTaskBoardStore().create()
  ui.actions.open()
  const board = createSnapshotStore<TaskBoardClientView>({
    status: 'ready',
    boardRevision: 10,
    tasks,
    pendingTaskIds: [],
    creating: false,
    error: null,
    ...boardOverrides,
  })
  const create = vi.fn((request: TaskBoardCreateRequest) => {
    const created = task('task-9', request.start ? 'running' : 'initialized', 'z', {
      title: request.title ?? '自动标题',
      description: request.description,
      acceptanceCriteria: request.acceptanceCriteria,
      ...(request.workspaceId === undefined ? {} : { workspaceId: request.workspaceId }),
      ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
      ...(request.agentPreset === undefined ? {} : { agentPreset: request.agentPreset }),
    })
    return success(created)
  })
  const props: TaskBoardOverlayProps = {
    useSessions: emptySessions(),
    useWorkspaces: workspaces(),
    useStore: bindSnapshotSelector(ui),
    actions: ui.actions,
    useBoard: bindSnapshotSelector(board),
    refresh: vi.fn(async () => ({ ok: true as const, value: tasks })),
    loadAgentPresets: vi.fn(async () => [
      { id: 'standard', name: '标准 Agent', isDefault: true },
      { id: 'minimal', name: '精简 Agent', isDefault: false },
    ]),
    pickDirectory: vi.fn(async () => '/tmp/picked-project'),
    uploadAttachment: vi.fn(async () => ({
      ok: true as const,
      value: {
        attachmentId: 'image:fixture' as never,
        mediaType: 'image/png' as const,
        bytes: 5,
        width: 1,
        height: 1,
        name: 'reference.png',
      },
    })),
    create,
    edit: vi.fn(async (_id, _patch) => ({ ok: true as const, value: tasks[0]! })),
    reorder: vi.fn(async (_id, _before) => ({ ok: true as const, value: tasks[0]! })),
    start: vi.fn(async id => ({ ok: true as const, value: tasks.find(item => item.id === id)! })),
    followup: vi.fn(async id => ({ ok: true as const, value: tasks.find(item => item.id === id)! })),
    approve: vi.fn(async id => ({ ok: true as const, value: tasks.find(item => item.id === id)! })),
    reject: vi.fn(async id => ({ ok: true as const, value: tasks.find(item => item.id === id)! })),
    retry: vi.fn(async id => ({ ok: true as const, value: tasks.find(item => item.id === id)! })),
    stop: vi.fn(async id => ({ ok: true as const, value: tasks.find(item => item.id === id)! })),
    reopen: vi.fn(async id => ({ ok: true as const, value: tasks.find(item => item.id === id)! })),
    delete: vi.fn(async (id: TaskBoardTaskId) => ({ ok: true as const, value: { deleted: true as const, taskId: id } })),
    loadRoundHistory: vi.fn(async (currentRound: TaskBoardRound) => ({
      rows: [],
      startSeq: currentRound.startSeq,
      endSeq: currentRound.endSeq,
      truncated: false,
    })),
    openSession: vi.fn(),
    t,
    ...overrides,
  }
  const view = render(<TaskBoardOverlay {...props} />)
  return { board, create, props, ui, view }
}

describe('TaskBoardOverlay Multica-style board', () => {
  it('renders five fixed columns with counts, live badges, and failure summary', () => {
    mount()

    for (const label of ['初始化', '执行中', '待审核', '已完成', '失败']) {
      expect(screen.getByRole('heading', { name: new RegExp(label) })).toBeDefined()
    }
    expect(screen.getByText('Agent 正在工作')).toBeDefined()
    expect(screen.getByText('模型服务暂时不可用')).toBeDefined()
    expect(screen.getAllByText('1')).toHaveLength(5)
  })

  it('renders synchronization states and retries cold or failed snapshots', async () => {
    const coldRefresh = vi.fn(async () => ({ ok: true as const, value: [] }))
    const cold = mount([], { refresh: coldRefresh }, { status: 'cold' })
    expect(screen.getByText('正在同步任务…')).toBeDefined()
    await waitFor(() => { expect(coldRefresh).toHaveBeenCalledOnce() })
    fireEvent.click(screen.getByRole('button', { name: '刷新任务面板' }))
    expect(coldRefresh).toHaveBeenCalledTimes(2)
    cold.view.unmount()

    const loadingRefresh = vi.fn(async () => ({ ok: true as const, value: [] }))
    const loading = mount([], { refresh: loadingRefresh }, { status: 'loading' })
    expect(screen.getByText('正在同步任务…')).toBeDefined()
    expect(loadingRefresh).not.toHaveBeenCalled()
    loading.view.unmount()

    const errorRefresh = vi.fn(async () => ({ ok: true as const, value: [] }))
    const failed = mount([], { refresh: errorRefresh }, {
      status: 'error',
      error: { code: 'connection-lost', message: '连接已断开。', details: {} },
    })
    expect(screen.getByRole('alert').textContent).toContain('连接已断开。')
    await waitFor(() => { expect(errorRefresh).toHaveBeenCalledOnce() })
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: '刷新任务面板' }))
    expect(errorRefresh).toHaveBeenCalledTimes(2)
    failed.view.unmount()

    mount([], {}, { status: 'error', error: null })
    expect(screen.getByRole('alert').textContent).toBe('任务面板同步失败刷新任务面板')
  })

  it('supports toolbar actions and unmodified keyboard shortcuts', async () => {
    const refresh = vi.fn(async () => ({ ok: true as const, value: TASKS }))
    const mounted = mount(TASKS, { refresh })
    const search = screen.getByRole('searchbox', { name: '搜索任务' })

    fireEvent.keyDown(document, { key: '/' })
    expect(document.activeElement).toBe(search)
    fireEvent.keyDown(search, { key: 'c' })
    expect(screen.queryByRole('dialog', { name: '新建任务' })).toBeNull()
    const editable = document.createElement('div')
    Object.defineProperty(editable, 'isContentEditable', { value: true })
    document.body.append(editable)
    fireEvent.keyDown(editable, { key: 'c' })
    expect(screen.queryByRole('dialog', { name: '新建任务' })).toBeNull()
    editable.remove()
    search.blur()
    fireEvent.keyDown(document, { key: 'c' })
    expect(screen.getByRole('dialog', { name: '新建任务' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '关闭新建任务' }))

    fireEvent.click(screen.getByRole('button', { name: '刷新任务面板' }))
    expect(refresh).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: '关闭任务面板' }))
    expect(mounted.ui.getSnapshot().open).toBe(false)
    expect(screen.queryByRole('region', { name: '任务面板' })).toBeNull()
  })

  it('searches, filters, switches list view, and hides optional card fields', () => {
    mount()

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索任务' }), {
      target: { value: '上传' },
    })
    expect(screen.getByText('修复上传失败')).toBeDefined()
    expect(screen.queryByText('规划 API 网关')).toBeNull()

    fireEvent.change(screen.getByRole('combobox', { name: '状态' }), {
      target: { value: 'running' },
    })
    expect(screen.queryByText('修复上传失败')).toBeNull()

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索任务' }), {
      target: { value: '' },
    })
    expect(screen.getByText('实现认证流程')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '列表' }))
    expect(screen.getByRole('table', { name: '任务列表' })).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: '显示' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '描述' }))
    expect(screen.queryByText('Requirement 2')).toBeNull()
  })

  it('opens the selected card detail from either board or list', () => {
    mount()

    fireEvent.click(screen.getByRole('button', { name: /规划 API 网关/ }))

    expect(screen.getByRole('dialog', { name: 'DSH-1 规划 API 网关' })).toBeDefined()
    expect(screen.getByText('Acceptance 1')).toBeDefined()
  })

  it('opens an agent-first create dialog and submits create-only Workspace task', async () => {
    const b = mount([])
    fireEvent.click(screen.getByRole('button', { name: '新建任务' }))

    const dialog = screen.getByRole('dialog', { name: '新建任务' })
    expect(dialog).toBeDefined()
    expect(within(dialog).getByRole('tab', { name: 'Agent 任务' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.change(within(dialog).getByLabelText('任务要求'), { target: { value: '实现任务面板' } })
    fireEvent.change(within(dialog).getByLabelText('验收标准'), { target: { value: '五种状态均可见' } })
    await within(dialog).findByRole('option', { name: '精简 Agent — minimal' })
    fireEvent.change(within(dialog).getByLabelText('Agent Preset'), { target: { value: 'minimal' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '仅创建' }))

    await waitFor(() => {
      expect(b.create).toHaveBeenCalledWith({
        description: '实现任务面板',
        acceptanceCriteria: '五种状态均可见',
        workspaceId: 'workspace-1',
        agentPreset: 'minimal',
        start: false,
      })
    })
  })

  it('requires a manual title and supports directory plus continue-creating flow', async () => {
    const b = mount([])
    fireEvent.click(screen.getByRole('button', { name: '新建任务' }))
    fireEvent.click(screen.getByRole('tab', { name: '手动任务' }))
    fireEvent.click(screen.getByRole('radio', { name: '指定目录' }))
    fireEvent.change(screen.getByLabelText('工作目录'), { target: { value: '/tmp/project' } })
    fireEvent.change(screen.getByLabelText('任务要求'), { target: { value: '整理发布说明' } })
    fireEvent.click(screen.getByRole('checkbox', { name: '创建后继续新建' }))
    fireEvent.click(screen.getByRole('button', { name: '创建并开始' }))
    expect(screen.getByRole('alert').textContent).toContain('标题')

    fireEvent.change(screen.getByLabelText('任务标题'), { target: { value: '发布 v1' } })
    fireEvent.click(screen.getByRole('button', { name: '创建并开始' }))

    await waitFor(() => {
      expect(b.create).toHaveBeenLastCalledWith({
        title: '发布 v1',
        description: '整理发布说明',
        acceptanceCriteria: '',
        cwd: '/tmp/project',
        start: true,
      })
    })
    expect(screen.getByRole('dialog', { name: '新建任务' })).toBeDefined()
    expect(screen.getByLabelText<HTMLInputElement>('任务标题').value).toBe('')
  })

  it('uses the preset roster, directory picker, and staged image attachments', async () => {
    const loadAgentPresets = vi.fn(async () => [
      { id: 'standard', name: '标准 Agent', isDefault: true },
      { id: 'minimal', name: '精简 Agent', isDefault: false },
    ])
    const pickDirectory = vi.fn(async () => '/tmp/picked-project')
    const uploadAttachment = vi.fn(async () => ({
      ok: true as const,
      value: {
        attachmentId: 'image:1' as never,
        mediaType: 'image/png' as const,
        bytes: 5,
        width: 1,
        height: 1,
        name: 'reference.png',
      },
    }))
    const b = mount([], { loadAgentPresets, pickDirectory, uploadAttachment })
    fireEvent.click(screen.getByRole('button', { name: '新建任务' }))
    const dialog = screen.getByRole('dialog', { name: '新建任务' })

    await waitFor(() => { expect(loadAgentPresets).toHaveBeenCalledOnce() })
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Agent Preset' }), {
      target: { value: 'minimal' },
    })
    fireEvent.click(within(dialog).getByRole('radio', { name: '指定目录' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '选择目录' }))
    await waitFor(() => {
      expect(within(dialog).getByLabelText<HTMLInputElement>('工作目录').value).toBe('/tmp/picked-project')
    })

    const file = new File([new Uint8Array([104, 101, 108, 108, 111])], 'reference.png', { type: 'image/png' })
    fireEvent.change(within(dialog).getByLabelText('添加参考图片'), { target: { files: [file] } })
    expect(within(dialog).getByText('reference.png')).toBeDefined()
    fireEvent.change(within(dialog).getByLabelText('任务要求'), { target: { value: '实现图片驱动的任务' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '仅创建' }))

    await waitFor(() => { expect(uploadAttachment).toHaveBeenCalledOnce() })
    await waitFor(() => {
      expect(b.create).toHaveBeenLastCalledWith({
        description: '实现图片驱动的任务',
        acceptanceCriteria: '',
        cwd: '/tmp/picked-project',
        agentPreset: 'minimal',
        attachments: [{
          attachmentId: 'image:1',
          mediaType: 'image/png',
          bytes: 5,
          width: 1,
          height: 1,
          name: 'reference.png',
        }],
        start: false,
      })
    })
  })

  it('preserves an open creation draft when the Workspace roster changes', () => {
    const workspaceStore = createSnapshotStore<WorkspaceListState>({
      items: [{
        workspaceId: 'workspace-1' as WorkspaceId,
        title: 'Harness',
        path: '/repo/harness',
        sessionIds: [],
        createdAt: '2026-08-14T00:00:00.000Z',
        updatedAt: '2026-08-14T00:00:00.000Z',
      }],
      archivedSessionIds: [],
      state: 'idle',
      phase: 'ready',
      error: null,
      baselinesReady: true,
      recentWorkspaceId: 'workspace-1' as WorkspaceId,
    })
    mount([], { useWorkspaces: bindSnapshotSelector(workspaceStore) })
    fireEvent.click(screen.getByRole('button', { name: '新建任务' }))
    const dialog = screen.getByRole('dialog', { name: '新建任务' })
    fireEvent.change(within(dialog).getByLabelText('任务要求'), {
      target: { value: '保留尚未提交的创建草稿' },
    })

    act(() => {
      workspaceStore.set({
        ...workspaceStore.getSnapshot(),
        items: [{
          workspaceId: 'workspace-2' as WorkspaceId,
          title: 'Second',
          path: '/repo/second',
          sessionIds: [],
          createdAt: '2026-08-14T00:01:00.000Z',
          updatedAt: '2026-08-14T00:01:00.000Z',
        }, ...workspaceStore.getSnapshot().items],
      })
    })

    expect(within(dialog).getByLabelText<HTMLTextAreaElement>('任务要求').value)
      .toBe('保留尚未提交的创建草稿')
    expect(within(dialog).getByRole<HTMLSelectElement>('combobox', { name: 'Workspace' }).value)
      .toBe('workspace-1')
  })

  it('closes only the innermost task-board layer with Escape', () => {
    const initialized = TASKS.find(task => task.status === 'initialized')!
    const first = mount([initialized])
    fireEvent.click(screen.getByRole('button', { name: /规划 API 网关/ }))
    fireEvent.click(screen.getByRole('button', { name: '删除任务' }))
    expect(screen.getByRole('dialog', { name: '删除这个任务？' })).toBeDefined()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '删除这个任务？' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'DSH-1 规划 API 网关' })).toBeDefined()
    first.view.unmount()

    const reviewed = task('task-3', 'review', 'a', {
      title: '审核部署脚本',
      currentSessionId: 'session-1' as never,
      rounds: [{
        id: 'round-1' as never,
        ordinal: 1,
        trigger: 'initial',
        status: 'completed',
        originStatus: 'initialized',
        sessionId: 'session-1' as never,
        prompts: [],
        startSeq: 1,
        endSeq: 4,
        startedAt: 1,
        endedAt: 2,
      }],
    })
    mount([reviewed])
    fireEvent.click(screen.getByRole('button', { name: /审核部署脚本/ }))
    fireEvent.click(screen.getByRole('button', { name: '查看第 1 轮执行日志' }))
    expect(screen.getByRole('dialog', { name: '执行日志 · DSH-3 · 第 1 轮' })).toBeDefined()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '执行日志 · DSH-3 · 第 1 轮' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'DSH-3 审核部署脚本' })).toBeDefined()
  })

  it('closes the task-board overlay with Escape when no child layer is open', () => {
    mount()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('region', { name: '任务面板' })).toBeNull()
  })

  it('requires rejection feedback and routes explicit review decisions', async () => {
    const reviewed = TASKS.find(task => task.status === 'review')!
    const approve = vi.fn(async () => ({ ok: true as const, value: reviewed }))
    const reject = vi.fn(async () => ({ ok: true as const, value: reviewed }))
    mount([reviewed], { approve, reject })
    fireEvent.click(screen.getByRole('button', { name: /审核部署脚本/ }))

    fireEvent.click(screen.getByRole('button', { name: '审核通过' }))
    await waitFor(() => { expect(approve).toHaveBeenCalledWith(reviewed.id) })

    const rejectButton = screen.getByRole('button', { name: '驳回并继续执行' })
    expect(rejectButton.hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getByLabelText('驳回反馈'), { target: { value: '请补充回滚验证' } })
    fireEvent.click(rejectButton)
    await waitFor(() => { expect(reject).toHaveBeenCalledWith(reviewed.id, '请补充回滚验证') })
  })

  it('never retries automatically and confirms a required fresh Session', async () => {
    const failed = TASKS.find(task => task.status === 'failed')!
    const retry = vi
      .fn<TaskBoardOverlayProps['retry']>()
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'fresh-session-required', sessionId: 'session-old' as never },
      })
      .mockResolvedValueOnce({ ok: true, value: failed })
    mount([failed], { retry })
    fireEvent.click(screen.getByRole('button', { name: /修复上传失败/ }))

    expect(retry).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '人工重试' }))
    await waitFor(() => {
      expect(retry).toHaveBeenCalledWith(failed.id, false)
    })
    expect(screen.getByRole('dialog', { name: '使用新 Session 重试？' })).toBeDefined()
    fireEvent.click(screen.getByRole('checkbox', { name: '我理解新 Session 不包含原会话上下文' }))
    fireEvent.click(screen.getByRole('button', { name: '使用新 Session 重试' }))
    await waitFor(() => {
      expect(retry).toHaveBeenLastCalledWith(failed.id, true)
    })
  })

  it('protects card deletion behind an explicit confirmation', async () => {
    const initialized = TASKS.find(task => task.status === 'initialized')!
    const remove = vi.fn(async (id: TaskBoardTaskId) => ({
      ok: true as const,
      value: { deleted: true as const, taskId: id },
    }))
    mount([initialized], { delete: remove })
    fireEvent.click(screen.getByRole('button', { name: /规划 API 网关/ }))
    fireEvent.click(screen.getByRole('button', { name: '删除任务' }))

    expect(remove).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: '删除这个任务？' })).toBeDefined()
    fireEvent.click(screen.getByRole('checkbox', { name: '我理解任务卡将被永久删除' }))
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    await waitFor(() => { expect(remove).toHaveBeenCalledWith(initialized.id) })
  })

  it('edits card content through compare-and-set task action', async () => {
    const initialized = TASKS.find(task => task.status === 'initialized')!
    const edit = vi.fn(async () => ({ ok: true as const, value: initialized }))
    mount([initialized], { edit })
    fireEvent.click(screen.getByRole('button', { name: /规划 API 网关/ }))
    fireEvent.click(screen.getByRole('button', { name: '编辑任务' }))

    const dialog = screen.getByRole('dialog', { name: '编辑 DSH-1' })
    fireEvent.change(within(dialog).getByLabelText('任务标题'), { target: { value: '重构 API 网关' } })
    fireEvent.change(within(dialog).getByLabelText('验收标准'), { target: { value: '全部网关测试通过' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '保存修改' }))

    await waitFor(() => {
      expect(edit).toHaveBeenCalledWith(initialized.id, {
        title: '重构 API 网关',
        description: initialized.description,
        acceptanceCriteria: '全部网关测试通过',
      })
    })
  })
})

describe('resolveTaskDrop', () => {
  it('returns a same-column anchor and rejects cross-column status changes', () => {
    const first = task('task-1', 'initialized', 'a')
    const second = task('task-2', 'initialized', 'b')
    const running = task('task-3', 'running', 'a')

    expect(resolveTaskDrop([first, second, running], second.id, first.id)).toEqual({
      kind: 'reorder',
      beforeTaskId: first.id,
    })
    expect(resolveTaskDrop([first, second, running], first.id, running.id)).toEqual({
      kind: 'forbidden',
      sourceStatus: 'initialized',
      targetStatus: 'running',
    })
  })

  it('moves downward after the hovered card and upward before it', () => {
    const first = task('task-1', 'initialized', 'a')
    const second = task('task-2', 'initialized', 'b')
    const third = task('task-3', 'initialized', 'c')

    expect(resolveTaskDrop([first, second, third], first.id, second.id)).toEqual({
      kind: 'reorder',
      beforeTaskId: third.id,
    })
    expect(resolveTaskDrop([first, second, third], first.id, third.id)).toEqual({ kind: 'reorder' })
    expect(resolveTaskDrop([first, second, third], third.id, first.id)).toEqual({
      kind: 'reorder',
      beforeTaskId: first.id,
    })
  })

  it('handles card, column, and unknown drop targets without changing workflow state', () => {
    const statuses: readonly TaskBoardStatus[] = ['initialized', 'running', 'review', 'done', 'failed']
    const cards = statuses.map((status, index) => task(`task-${index + 1}`, status, String(index)))

    for (const card of cards) {
      expect(resolveTaskDrop(cards, card.id, `${TASK_BOARD_COLUMN_PREFIX}${card.status}`)).toEqual({
        kind: 'reorder',
      })
      expect(resolveTaskDrop(cards, card.id, card.id)).toEqual({ kind: 'ignore' })
    }
    expect(resolveTaskDrop(cards, 'missing-task' as TaskBoardTaskId, cards[0]!.id)).toEqual({ kind: 'ignore' })
    expect(resolveTaskDrop(cards, cards[0]!.id, 'unknown-target')).toEqual({ kind: 'ignore' })
    expect(resolveTaskDrop(cards, cards[0]!.id, `${TASK_BOARD_COLUMN_PREFIX}unknown`)).toEqual({ kind: 'ignore' })
  })
})
