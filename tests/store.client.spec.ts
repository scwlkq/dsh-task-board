import { describe, expect, it, vi } from 'vitest'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  TaskBoardChange,
  TaskBoardCreateRequest,
  TaskBoardDeleteResult,
  TaskBoardEditPatch,
  TaskBoardFollowupRequest,
  TaskBoardRejectRequest,
  TaskBoardReorderRequest,
  TaskBoardRetryRequest,
  TaskBoardSnapshotResult,
  TaskBoardStatus,
  TaskBoardTask,
  TaskBoardTaskId,
  TaskBoardTaskRef,
  TaskBoardTaskResult,
} from '../src/types.ts'
import {
  TaskBoardController,
  taskBoardErrorMessage,
  type TaskBoardRemote,
} from '../src/client/controller.ts'
import { createTaskBoardStore } from '../src/client/store.ts'

function task(
  id: string,
  position: string,
  revision = 1,
  status: TaskBoardStatus = 'initialized',
): TaskBoardTask {
  const sequence = Number(id.replace(/\D/g, '')) || 1
  return {
    id: id as TaskBoardTaskId,
    sequence,
    identifier: `DSH-${sequence}`,
    revision,
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
  }
}

function carried<T>(value: T): RemoteResult<T> {
  return { ok: true, value }
}

function snapshotResult(boardRevision: number, tasks: readonly TaskBoardTask[]): RemoteResult<TaskBoardSnapshotResult> {
  return carried({ ok: true, value: { boardRevision, tasks } })
}

function taskResult(value: TaskBoardTask): RemoteResult<TaskBoardTaskResult> {
  return carried({ ok: true, value })
}

function remote(overrides: Partial<TaskBoardRemote> = {}): TaskBoardRemote {
  const rejected = async (): Promise<RemoteResult<TaskBoardTaskResult>> => carried({
    ok: false,
    error: { code: 'invalid-transition', status: 'initialized', operation: 'test' },
  })
  return {
    snapshot: vi.fn(async () => snapshotResult(0, [])),
    uploadAttachment: vi.fn(async () => carried({
      ok: false as const,
      error: { code: 'invalid-request' as const, field: 'attachment', message: 'not configured' },
    })),
    create: vi.fn(async (_request: TaskBoardCreateRequest) => rejected()),
    edit: vi.fn(async (_ref: TaskBoardTaskRef, _patch: TaskBoardEditPatch) => rejected()),
    reorder: vi.fn(async (_ref: TaskBoardTaskRef, _request: TaskBoardReorderRequest) => rejected()),
    start: vi.fn(async (_ref: TaskBoardTaskRef) => rejected()),
    followup: vi.fn(async (_ref: TaskBoardTaskRef, _request: TaskBoardFollowupRequest) => rejected()),
    approve: vi.fn(async (_ref: TaskBoardTaskRef) => rejected()),
    reject: vi.fn(async (_ref: TaskBoardTaskRef, _request: TaskBoardRejectRequest) => rejected()),
    retry: vi.fn(async (_ref: TaskBoardTaskRef, _request: TaskBoardRetryRequest) => rejected()),
    stop: vi.fn(async (_ref: TaskBoardTaskRef) => rejected()),
    reopen: vi.fn(async (_ref: TaskBoardTaskRef) => rejected()),
    delete: vi.fn(async (_ref: TaskBoardTaskRef): Promise<RemoteResult<TaskBoardDeleteResult>> => carried({
      ok: false,
      error: { code: 'task-not-found', taskId: 'missing' as TaskBoardTaskId },
    })),
    ...overrides,
  }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

describe('TaskBoardController', () => {
  it('starts cold and installs an authoritative snapshot', async () => {
    const first = task('task-1', 'a')
    const controller = new TaskBoardController(remote({
      snapshot: vi.fn(async () => snapshotResult(3, [first])),
    }))

    expect(controller.getSnapshot()).toMatchObject({
      status: 'cold',
      boardRevision: 0,
      tasks: [],
    })

    expect((await controller.refresh()).ok).toBe(true)
    expect(controller.getSnapshot()).toMatchObject({
      status: 'ready',
      boardRevision: 3,
      tasks: [first],
      error: null,
    })
  })

  it('uploads a staged attachment without mutating the board projection', async () => {
    const first = task('task-1', 'a')
    const uploadAttachment = vi.fn(async () => carried({
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
    const controller = new TaskBoardController(remote({
      snapshot: vi.fn(async () => snapshotResult(1, [first])),
      uploadAttachment,
    }))
    await controller.refresh()

    await expect(controller.uploadAttachment({
      mediaType: 'image/png',
      data: 'aGVsbG8=',
      name: 'reference.png',
    })).resolves.toMatchObject({
      ok: true,
      value: { attachmentId: 'image:1' },
    })
    expect(controller.getSnapshot().tasks).toEqual([first])
  })

  it('applies only the exact next change and ignores stale delivery', async () => {
    const first = task('task-1', 'a')
    const changed = { ...first, revision: 2, title: 'Changed' }
    const api = remote({ snapshot: vi.fn(async () => snapshotResult(4, [first])) })
    const controller = new TaskBoardController(api)
    await controller.refresh()

    await controller.acceptChange({
      boardRevision: 5,
      operation: 'updated',
      taskId: first.id,
      task: changed,
    })
    await controller.acceptChange({
      boardRevision: 4,
      operation: 'deleted',
      taskId: first.id,
    })

    expect(controller.getSnapshot().boardRevision).toBe(5)
    expect(controller.getSnapshot().tasks).toEqual([changed])
    expect(api.snapshot).toHaveBeenCalledOnce()
  })

  it('refreshes when a pushed change skips a board revision', async () => {
    const first = task('task-1', 'a')
    const second = task('task-2', 'b')
    const snapshot = vi
      .fn<TaskBoardRemote['snapshot']>()
      .mockResolvedValueOnce(snapshotResult(2, [first]))
      .mockResolvedValueOnce(snapshotResult(5, [first, second]))
    const controller = new TaskBoardController(remote({ snapshot }))
    await controller.refresh()

    const gap: TaskBoardChange = {
      boardRevision: 4,
      operation: 'created',
      taskId: second.id,
      task: second,
    }
    await controller.acceptChange(gap)

    expect(snapshot).toHaveBeenCalledTimes(2)
    expect(controller.getSnapshot()).toMatchObject({
      boardRevision: 5,
      tasks: [first, second],
    })
  })

  it('refreshes the snapshot after a connection reset', async () => {
    const snapshot = vi
      .fn<TaskBoardRemote['snapshot']>()
      .mockResolvedValueOnce(snapshotResult(1, []))
      .mockResolvedValueOnce(snapshotResult(2, [task('task-1', 'a')]))
    const controller = new TaskBoardController(remote({ snapshot }))
    await controller.refresh()

    await controller.connectionReset()

    expect(snapshot).toHaveBeenCalledTimes(2)
    expect(controller.getSnapshot().boardRevision).toBe(2)
  })

  it('replaces a stale card with the conflict response authority', async () => {
    const stale = task('task-1', 'a', 1)
    const current = { ...stale, revision: 2, title: 'Elsewhere' }
    const edit = vi.fn<TaskBoardRemote['edit']>(async () => carried({
      ok: false,
      error: { code: 'revision-conflict', current },
    }))
    const controller = new TaskBoardController(remote({
      snapshot: vi.fn(async () => snapshotResult(7, [stale])),
      edit,
    }))
    await controller.refresh()

    const result = await controller.edit(stale.id, { title: 'Mine' })

    expect(result).toMatchObject({ ok: false, error: { code: 'revision-conflict' } })
    expect(controller.getSnapshot().tasks).toEqual([current])
    expect(edit).toHaveBeenCalledWith({ id: stale.id, revision: 1 }, { title: 'Mine' })
  })

  it('publishes pending state until a mutation settles', async () => {
    const first = task('task-1', 'a')
    const pending = deferred<RemoteResult<TaskBoardTaskResult>>()
    const start = vi.fn<TaskBoardRemote['start']>(() => pending.promise)
    const controller = new TaskBoardController(remote({
      snapshot: vi.fn(async () => snapshotResult(1, [first])),
      start,
    }))
    await controller.refresh()

    const operation = controller.start(first.id)
    expect(controller.getSnapshot().pendingTaskIds).toEqual([first.id])

    pending.resolve(taskResult({ ...first, revision: 2, status: 'running' }))
    await operation

    expect(controller.getSnapshot().pendingTaskIds).toEqual([])
    expect(controller.getSnapshot().tasks[0]?.status).toBe('running')
  })

  it('rolls back optimistic same-column ordering when the Host rejects it', async () => {
    const first = task('task-1', 'a')
    const second = task('task-2', 'b')
    const third = task('task-3', 'c')
    const pending = deferred<RemoteResult<TaskBoardTaskResult>>()
    const reorder = vi.fn<TaskBoardRemote['reorder']>(() => pending.promise)
    const controller = new TaskBoardController(remote({
      snapshot: vi.fn(async () => snapshotResult(9, [first, second, third])),
      reorder,
    }))
    await controller.refresh()

    const operation = controller.reorder(second.id, first.id)
    expect(controller.getSnapshot().tasks.map(item => item.id)).toEqual([
      second.id,
      first.id,
      third.id,
    ])

    pending.resolve(carried({
      ok: false,
      error: { code: 'invalid-transition', status: 'initialized', operation: 'reorder' },
    }))
    await operation

    expect(controller.getSnapshot().tasks.map(item => item.id)).toEqual([
      first.id,
      second.id,
      third.id,
    ])
  })
})

describe('TaskBoardController edge behavior', () => {
  const createRequest: TaskBoardCreateRequest = {
    title: '',
    description: 'Controller edge behavior',
    acceptanceCriteria: '',
    start: false,
  }
  const carrierFailure = {
    ok: false as const,
    error: { code: 'connection-lost', message: 'Connection lost.', details: {} },
  }

  it('formats failures, orders snapshots deterministically, and honors subscription disposal', async () => {
    expect(taskBoardErrorMessage(carrierFailure.error)).toBe('Connection lost.')
    expect(taskBoardErrorMessage({
      code: 'task-not-found',
      taskId: 'missing' as TaskBoardTaskId,
    })).toBe('task-not-found')

    const initializedLater = task('task-3', 'b', 1, 'initialized')
    const initializedSecond = task('task-2', 'a', 1, 'initialized')
    const initializedFirst = task('task-1', 'a', 1, 'initialized')
    const failed = task('task-4', 'a', 1, 'failed')
    const api = remote({
      snapshot: vi.fn(async () => snapshotResult(4, [failed, initializedLater, initializedSecond, initializedFirst])),
    })
    const controller = new TaskBoardController(api)
    const listener = vi.fn()
    const unsubscribe = controller.subscribe(listener)

    await controller.refresh()
    expect(controller.getSnapshot().tasks.map(item => item.id)).toEqual([
      initializedFirst.id,
      initializedSecond.id,
      initializedLater.id,
      failed.id,
    ])
    expect(listener).toHaveBeenCalledTimes(2)

    unsubscribe()
    await controller.refresh()
    expect(listener).toHaveBeenCalledTimes(2)
    controller.dispose()
    await expect(controller.refresh()).resolves.toMatchObject({
      ok: false,
      error: { code: 'client-operation-failed', message: 'task-board controller disposed' },
    })
    await expect(controller.acceptChange({
      boardRevision: 5,
      operation: 'deleted',
      taskId: initializedFirst.id,
    })).resolves.toBeUndefined()
  })

  it('coalesces refreshes and applies an exact deletion after the in-flight snapshot', async () => {
    const first = task('task-1', 'a')
    const pending = deferred<RemoteResult<TaskBoardSnapshotResult>>()
    const snapshot = vi.fn<TaskBoardRemote['snapshot']>(() => pending.promise)
    const controller = new TaskBoardController(remote({ snapshot }))

    const firstRefresh = controller.refresh()
    const secondRefresh = controller.refresh()
    expect(secondRefresh).toBe(firstRefresh)
    const change = controller.acceptChange({
      boardRevision: 2,
      operation: 'deleted',
      taskId: first.id,
    })
    pending.resolve(snapshotResult(1, [first]))
    await Promise.all([firstRefresh, change])

    expect(snapshot).toHaveBeenCalledOnce()
    expect(controller.getSnapshot()).toMatchObject({ boardRevision: 2, tasks: [] })
  })

  it('refreshes cold and payload-free forwarded changes', async () => {
    const first = task('task-1', 'a')
    const changed = { ...first, revision: 2, title: 'Changed elsewhere' }
    const snapshot = vi.fn<TaskBoardRemote['snapshot']>()
      .mockResolvedValueOnce(snapshotResult(1, [first]))
      .mockResolvedValueOnce(snapshotResult(2, [changed]))
    const controller = new TaskBoardController(remote({ snapshot }))

    await controller.acceptChange({
      boardRevision: 1,
      operation: 'created',
      taskId: first.id,
      task: first,
    })
    await controller.acceptChange({
      boardRevision: 2,
      operation: 'updated',
      taskId: first.id,
    })

    expect(snapshot).toHaveBeenCalledTimes(2)
    expect(controller.getSnapshot().tasks).toEqual([changed])
  })

  it('normalizes snapshot carrier, business, thrown, and late-disposal outcomes', async () => {
    const carrier = new TaskBoardController(remote({ snapshot: vi.fn(async () => carrierFailure) }))
    await expect(carrier.refresh()).resolves.toMatchObject({ ok: false, error: carrierFailure.error })
    expect(carrier.getSnapshot().status).toBe('error')

    const businessError = {
      code: 'invalid-request' as const,
      field: 'snapshot',
      message: 'Snapshot rejected.',
    }
    const business = new TaskBoardController(remote({
      snapshot: vi.fn(async () => carried({ ok: false as const, error: businessError })),
    }))
    await expect(business.refresh()).resolves.toEqual({ ok: false, error: businessError })

    const thrown = new TaskBoardController(remote({
      snapshot: vi.fn(async () => { throw new Error('snapshot unavailable') }),
    }))
    await expect(thrown.refresh()).resolves.toMatchObject({
      ok: false,
      error: { code: 'client-operation-failed', message: 'snapshot unavailable' },
    })

    const pending = deferred<RemoteResult<TaskBoardSnapshotResult>>()
    const late = new TaskBoardController(remote({ snapshot: vi.fn(() => pending.promise) }))
    const operation = late.refresh()
    late.dispose()
    pending.resolve(snapshotResult(9, [task('task-9', 'a')]))
    await expect(operation).resolves.toMatchObject({ ok: true })
    expect(late.getSnapshot()).toMatchObject({ status: 'loading', boardRevision: 0 })
  })

  it('normalizes create and upload outcomes while preserving projection state', async () => {
    const created = task('task-8', 'a')
    const create = vi.fn<TaskBoardRemote['create']>()
      .mockResolvedValueOnce(carrierFailure)
      .mockResolvedValueOnce(carried({
        ok: false,
        error: { code: 'invalid-request', field: 'description', message: 'Description required.' },
      }))
      .mockResolvedValueOnce(taskResult(created))
      .mockRejectedValueOnce('create transport closed')
    const uploadAttachment = vi.fn<TaskBoardRemote['uploadAttachment']>()
      .mockResolvedValueOnce(carrierFailure)
      .mockRejectedValueOnce(new Error('upload transport closed'))
    const controller = new TaskBoardController(remote({ create, uploadAttachment }))

    await expect(controller.create(createRequest)).resolves.toMatchObject({ ok: false, error: carrierFailure.error })
    await expect(controller.create(createRequest)).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-request' },
    })
    await expect(controller.create(createRequest)).resolves.toMatchObject({ ok: true, value: created })
    expect(controller.getSnapshot()).toMatchObject({ creating: false, tasks: [created] })
    await expect(controller.create(createRequest)).resolves.toMatchObject({
      ok: false,
      error: { code: 'client-operation-failed', message: 'create transport closed' },
    })
    await expect(controller.uploadAttachment({ mediaType: 'image/png', data: '' })).resolves.toMatchObject({
      ok: false,
      error: carrierFailure.error,
    })
    await expect(controller.uploadAttachment({ mediaType: 'image/png', data: '' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'client-operation-failed', message: 'upload transport closed' },
    })
  })

  it('routes every task mutation with the observed revision and normalizes failures', async () => {
    const first = task('task-1', 'a', 3)
    const success = taskResult(first)
    const edit = vi.fn<TaskBoardRemote['edit']>(async () => carrierFailure)
    const start = vi.fn<TaskBoardRemote['start']>(async () => { throw new Error('start transport closed') })
    const followup = vi.fn<TaskBoardRemote['followup']>(async () => taskResult({ ...first, revision: 2 }))
    const approve = vi.fn<TaskBoardRemote['approve']>(async () => success)
    const reject = vi.fn<TaskBoardRemote['reject']>(async () => success)
    const retry = vi.fn<TaskBoardRemote['retry']>(async () => success)
    const stop = vi.fn<TaskBoardRemote['stop']>(async () => success)
    const reopen = vi.fn<TaskBoardRemote['reopen']>(async () => success)
    const controller = new TaskBoardController(remote({
      snapshot: vi.fn(async () => snapshotResult(3, [first])),
      edit,
      start,
      followup,
      approve,
      reject,
      retry,
      stop,
      reopen,
    }))
    await controller.refresh()

    await expect(controller.start('missing' as TaskBoardTaskId)).resolves.toMatchObject({
      ok: false,
      error: { code: 'task-not-found' },
    })
    await expect(controller.edit(first.id, { title: 'Mine' })).resolves.toMatchObject({
      ok: false,
      error: carrierFailure.error,
    })
    await expect(controller.start(first.id)).resolves.toMatchObject({
      ok: false,
      error: { code: 'client-operation-failed', message: 'start transport closed' },
    })
    await expect(controller.followup(first.id, 'Continue')).resolves.toMatchObject({ ok: true })
    expect(controller.getSnapshot().tasks[0]?.revision).toBe(3)
    await controller.approve(first.id)
    await controller.reject(first.id, 'Revise')
    await controller.retry(first.id, true)
    await controller.stop(first.id)
    await controller.reopen(first.id)

    expect(followup).toHaveBeenCalledWith({ id: first.id, revision: 3 }, { text: 'Continue' })
    expect(reject).toHaveBeenCalledWith({ id: first.id, revision: 3 }, { feedback: 'Revise' })
    expect(retry).toHaveBeenCalledWith({ id: first.id, revision: 3 }, { allowFreshSession: true })
    for (const operation of [approve, stop, reopen]) {
      expect(operation).toHaveBeenCalledWith({ id: first.id, revision: 3 })
    }
  })

  it('normalizes delete outcomes and replaces conflict authority', async () => {
    const first = task('task-1', 'a', 1)
    const current = { ...first, revision: 2, title: 'Current' }
    const remove = vi.fn<TaskBoardRemote['delete']>()
      .mockResolvedValueOnce(carrierFailure)
      .mockResolvedValueOnce(carried({
        ok: false,
        error: { code: 'revision-conflict', current },
      }))
      .mockRejectedValueOnce(new Error('delete transport closed'))
      .mockResolvedValueOnce(carried({
        ok: true,
        value: { deleted: true, taskId: first.id },
      }))
    const controller = new TaskBoardController(remote({
      snapshot: vi.fn(async () => snapshotResult(1, [first])),
      delete: remove,
    }))
    await controller.refresh()

    await expect(controller.delete('missing' as TaskBoardTaskId)).resolves.toMatchObject({
      ok: false,
      error: { code: 'task-not-found' },
    })
    await expect(controller.delete(first.id)).resolves.toMatchObject({ ok: false, error: carrierFailure.error })
    await expect(controller.delete(first.id)).resolves.toMatchObject({
      ok: false,
      error: { code: 'revision-conflict' },
    })
    expect(controller.getSnapshot().tasks).toEqual([current])
    await expect(controller.delete(first.id)).resolves.toMatchObject({
      ok: false,
      error: { code: 'client-operation-failed', message: 'delete transport closed' },
    })
    await expect(controller.delete(first.id)).resolves.toMatchObject({ ok: true })
    expect(controller.getSnapshot().tasks).toEqual([])
  })

  it('validates reorder targets and refreshes authority when a rejected move races a change', async () => {
    const first = task('task-1', 'a')
    const second = task('task-2', 'b')
    const running = task('task-3', 'a', 1, 'running')
    const pending = deferred<RemoteResult<TaskBoardTaskResult>>()
    const reorder = vi.fn<TaskBoardRemote['reorder']>()
      .mockResolvedValueOnce(taskResult(first))
      .mockResolvedValueOnce(taskResult(first))
      .mockImplementationOnce(() => pending.promise)
    const snapshot = vi.fn<TaskBoardRemote['snapshot']>()
      .mockResolvedValueOnce(snapshotResult(4, [first, second, running]))
      .mockResolvedValueOnce(snapshotResult(6, [second, first, running]))
    const controller = new TaskBoardController(remote({ snapshot, reorder }))
    await controller.refresh()

    await expect(controller.reorder('missing' as TaskBoardTaskId)).resolves.toMatchObject({
      ok: false,
      error: { code: 'task-not-found' },
    })
    await expect(controller.reorder(first.id, running.id)).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-transition', operation: 'reorder' },
    })
    await controller.reorder(first.id)
    await controller.reorder(first.id, 'missing-anchor' as TaskBoardTaskId)

    const operation = controller.reorder(first.id, second.id)
    await controller.acceptChange({
      boardRevision: 5,
      operation: 'updated',
      taskId: running.id,
      task: { ...running, revision: 2 },
    })
    pending.resolve(carried({
      ok: false,
      error: { code: 'invalid-transition', status: 'initialized', operation: 'reorder' },
    }))
    await operation

    expect(reorder).toHaveBeenNthCalledWith(1, { id: first.id, revision: 1 }, {})
    expect(reorder).toHaveBeenNthCalledWith(2, { id: first.id, revision: 1 }, {
      beforeTaskId: 'missing-anchor',
    })
    expect(snapshot).toHaveBeenCalledTimes(2)
    expect(controller.getSnapshot()).toMatchObject({ boardRevision: 6 })
  })

  it('keeps a task pending until all concurrent mutations settle', async () => {
    const first = task('task-1', 'a')
    const firstPending = deferred<RemoteResult<TaskBoardTaskResult>>()
    const secondPending = deferred<RemoteResult<TaskBoardTaskResult>>()
    const controller = new TaskBoardController(remote({
      snapshot: vi.fn(async () => snapshotResult(1, [first])),
      start: vi.fn(() => firstPending.promise),
      edit: vi.fn(() => secondPending.promise),
    }))
    await controller.refresh()

    const starting = controller.start(first.id)
    const editing = controller.edit(first.id, { title: 'Concurrent' })
    expect(controller.getSnapshot().pendingTaskIds).toEqual([first.id])

    firstPending.resolve(taskResult({ ...first, revision: 2, status: 'running' }))
    await starting
    expect(controller.getSnapshot().pendingTaskIds).toEqual([first.id])

    secondPending.resolve(taskResult({ ...first, revision: 3, title: 'Concurrent' }))
    await editing
    expect(controller.getSnapshot().pendingTaskIds).toEqual([])
  })
})

describe('task-board shared UI store', () => {
  it('keeps overlay, selection, filters, and display preferences in one root-scoped store', () => {
    const store = createTaskBoardStore().create()
    const selected = 'task-7' as TaskBoardTaskId

    expect(store.getSnapshot()).toMatchObject({
      open: false,
      createOpen: false,
      selectedTaskId: null,
      selectedRoundId: null,
      query: '',
      statusFilter: 'all',
      locationFilter: 'all',
      agentPresetFilter: 'all',
      viewMode: 'board',
      display: {
        description: true,
        agentPreset: true,
        location: true,
        rounds: true,
        updatedAt: true,
      },
    })

    store.actions.open()
    store.actions.openCreate('review')
    store.actions.selectTask(selected)
    store.actions.setQuery('gateway')
    store.actions.setStatusFilter('failed')
    store.actions.setLocationFilter('cwd:/tmp/project')
    store.actions.setAgentPresetFilter('reviewer')
    store.actions.setViewMode('list')
    store.actions.toggleDisplay('description')

    expect(store.getSnapshot()).toMatchObject({
      open: true,
      createOpen: true,
      createStatusHint: 'review',
      selectedTaskId: selected,
      query: 'gateway',
      statusFilter: 'failed',
      locationFilter: 'cwd:/tmp/project',
      agentPresetFilter: 'reviewer',
      viewMode: 'list',
      display: { description: false },
    })

    store.actions.close()
    expect(store.getSnapshot()).toMatchObject({
      open: false,
      createOpen: false,
      selectedTaskId: null,
      selectedRoundId: null,
    })
  })
})
