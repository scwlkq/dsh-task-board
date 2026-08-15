/**
 * Browser object layer for the authoritative task-board snapshot.
 * @module @deepseek-ai/dsh-client-ui-task-board/client/controller
 */

import type { RemoteFailure, RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type {
  TaskBoardAttachmentResult,
  TaskBoardAttachmentUploadRequest,
  TaskBoardChange,
  TaskBoardCreateRequest,
  TaskBoardDeleteResult,
  TaskBoardDeleteValue,
  TaskBoardEditPatch,
  TaskBoardFailureResult,
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
} from '../types.ts'

/** Generated task-board Remote methods consumed by the Client controller. */
export interface TaskBoardRemote {
  snapshot: () => Promise<RemoteResult<TaskBoardSnapshotResult>>
  uploadAttachment: (request: TaskBoardAttachmentUploadRequest) => Promise<RemoteResult<TaskBoardAttachmentResult>>
  create: (request: TaskBoardCreateRequest) => Promise<RemoteResult<TaskBoardTaskResult>>
  edit: (ref: TaskBoardTaskRef, patch: TaskBoardEditPatch) => Promise<RemoteResult<TaskBoardTaskResult>>
  reorder: (ref: TaskBoardTaskRef, request: TaskBoardReorderRequest) => Promise<RemoteResult<TaskBoardTaskResult>>
  start: (ref: TaskBoardTaskRef) => Promise<RemoteResult<TaskBoardTaskResult>>
  followup: (ref: TaskBoardTaskRef, request: TaskBoardFollowupRequest) => Promise<RemoteResult<TaskBoardTaskResult>>
  approve: (ref: TaskBoardTaskRef) => Promise<RemoteResult<TaskBoardTaskResult>>
  reject: (ref: TaskBoardTaskRef, request: TaskBoardRejectRequest) => Promise<RemoteResult<TaskBoardTaskResult>>
  retry: (ref: TaskBoardTaskRef, request: TaskBoardRetryRequest) => Promise<RemoteResult<TaskBoardTaskResult>>
  stop: (ref: TaskBoardTaskRef) => Promise<RemoteResult<TaskBoardTaskResult>>
  reopen: (ref: TaskBoardTaskRef) => Promise<RemoteResult<TaskBoardTaskResult>>
  delete: (ref: TaskBoardTaskRef) => Promise<RemoteResult<TaskBoardDeleteResult>>
}

/** Loading phase for the shared authoritative board projection. */
export type TaskBoardClientStatus = 'cold' | 'loading' | 'ready' | 'error'

/** Immutable view published to both task-board slot entries. */
export interface TaskBoardClientView {
  readonly status: TaskBoardClientStatus
  readonly boardRevision: number
  readonly tasks: readonly TaskBoardTask[]
  readonly pendingTaskIds: readonly TaskBoardTaskId[]
  readonly creating: boolean
  readonly error: RemoteFailure | TaskBoardFailureResult | null
}

/** One normalized Client operation result across carrier and business failures. */
export type TaskBoardClientResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: RemoteFailure | TaskBoardFailureResult }

/**
 * Resolve a correction-oriented message from an open carrier/business failure.
 * @param error - normalized task-board failure.
 * @returns Host message when present, otherwise stable failure code.
 */
export function taskBoardErrorMessage(error: RemoteFailure | TaskBoardFailureResult): string {
  return 'message' in error ? error.message : error.code
}

const STATUS_ORDER: Readonly<Record<TaskBoardStatus, number>> = {
  initialized: 0,
  running: 1,
  review: 2,
  done: 3,
  failed: 4,
}

const INITIAL_VIEW: TaskBoardClientView = Object.freeze({
  status: 'cold',
  boardRevision: 0,
  tasks: Object.freeze([]),
  pendingTaskIds: Object.freeze([]),
  creating: false,
  error: null,
})

function ordered(tasks: readonly TaskBoardTask[]): readonly TaskBoardTask[] {
  return [...tasks].sort((left, right) => {
    const status = STATUS_ORDER[left.status] - STATUS_ORDER[right.status]
    if (status !== 0) return status
    const position = left.position.localeCompare(right.position)
    if (position !== 0) return position
    return left.sequence - right.sequence
  })
}

function transportError(error: unknown): RemoteFailure {
  return {
    code: 'client-operation-failed',
    message: error instanceof Error ? error.message : String(error),
    details: {},
  }
}

function notFound(taskId: TaskBoardTaskId): TaskBoardClientResult<never> {
  return { ok: false, error: { code: 'task-not-found', taskId } }
}

/**
 * Owns task-board Remote synchronization and mutation serialization state.
 * Components consume it through the slot framework's injected observable hook.
 */
export class TaskBoardController implements HostObservable<TaskBoardClientView> {
  private view = INITIAL_VIEW
  private readonly listeners = new Set<() => void>()
  private readonly pendingTaskCounts = new Map<TaskBoardTaskId, number>()
  private refreshPromise: Promise<TaskBoardClientResult<readonly TaskBoardTask[]>> | null = null
  private disposed = false

  /**
   * @param remote - generated `taskBoard` Remote namespace.
   */
  constructor(private readonly remote: TaskBoardRemote) {}

  /** @returns current immutable board projection. */
  getSnapshot = (): TaskBoardClientView => this.view

  /**
   * Subscribe to projection replacement.
   * @param listener - callback invoked after each committed Client view change.
   * @returns subscription disposer.
   */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Read a full authoritative snapshot, coalescing concurrent callers.
   * @returns normalized load result.
   */
  refresh(): Promise<TaskBoardClientResult<readonly TaskBoardTask[]>> {
    if (this.disposed) {
      return Promise.resolve({ ok: false, error: transportError(new Error('task-board controller disposed')) })
    }
    if (this.refreshPromise !== null) return this.refreshPromise

    this.patch({ status: 'loading', error: null })
    const pending = this.readSnapshot()
    this.refreshPromise = pending
    void pending.finally(() => {
      this.refreshPromise = null
    })
    return pending
  }

  /**
   * Reconcile one forwarded committed Host change.
   * @param change - revisioned task-board event.
   * @returns completion after any required snapshot refresh.
   */
  async acceptChange(change: TaskBoardChange): Promise<void> {
    if (this.disposed) return
    if (this.refreshPromise !== null) await this.refreshPromise
    if (change.boardRevision <= this.view.boardRevision) return
    if (this.view.status === 'cold' || change.boardRevision !== this.view.boardRevision + 1) {
      await this.refresh()
      return
    }

    if (change.operation === 'deleted') {
      this.commit({
        ...this.view,
        boardRevision: change.boardRevision,
        tasks: this.view.tasks.filter(task => task.id !== change.taskId),
      })
      return
    }
    if (change.task === undefined) {
      await this.refresh()
      return
    }
    this.commit({
      ...this.view,
      boardRevision: change.boardRevision,
      tasks: this.upsert(this.view.tasks, change.task),
    })
  }

  /**
   * Re-read authority after a new transport generation is established.
   * @returns normalized refresh result.
   */
  connectionReset(): Promise<TaskBoardClientResult<readonly TaskBoardTask[]>> {
    return this.refresh()
  }

  /**
   * Create a durable card and optionally start its first execution round.
   * @param request - card fields and start intent.
   * @returns committed card or normalized failure.
   */
  async create(request: TaskBoardCreateRequest): Promise<TaskBoardClientResult<TaskBoardTask>> {
    this.patch({ creating: true })
    try {
      const carried = await this.remote.create(request)
      if (!carried.ok) return { ok: false, error: carried.error }
      if (!carried.value.ok) return carried.value
      this.replaceTask(carried.value.value)
      return carried.value
    } catch (error) {
      return { ok: false, error: transportError(error) }
    } finally {
      this.patch({ creating: false })
    }
  }

  /**
   * Persist one browser-staged task image without changing the board projection.
   * @param request - Canonical image upload payload.
   * @returns Durable attachment reference or normalized failure.
   */
  async uploadAttachment(
    request: TaskBoardAttachmentUploadRequest,
  ): Promise<TaskBoardClientResult<ImageAttachmentRef>> {
    try {
      const carried = await this.remote.uploadAttachment(request)
      return carried.ok ? carried.value : { ok: false, error: carried.error }
    } catch (error) {
      return { ok: false, error: transportError(error) }
    }
  }

  /**
   * Edit material task fields using the latest observed revision.
   * @param taskId - card identity.
   * @param patch - replacement fields.
   * @returns committed card or normalized failure.
   */
  edit(taskId: TaskBoardTaskId, patch: TaskBoardEditPatch): Promise<TaskBoardClientResult<TaskBoardTask>> {
    return this.mutateTask(taskId, ref => this.remote.edit(ref, patch))
  }

  /**
   * Start one initialized card.
   * @param taskId - card identity.
   * @returns committed running card or normalized failure.
   */
  start(taskId: TaskBoardTaskId): Promise<TaskBoardClientResult<TaskBoardTask>> {
    return this.mutateTask(taskId, ref => this.remote.start(ref))
  }

  /**
   * Add another instruction to the active execution round.
   * @param taskId - card identity.
   * @param text - non-blank follow-up text.
   * @returns committed card or normalized failure.
   */
  followup(taskId: TaskBoardTaskId, text: string): Promise<TaskBoardClientResult<TaskBoardTask>> {
    return this.mutateTask(taskId, ref => this.remote.followup(ref, { text }))
  }

  /**
   * Approve reviewed output.
   * @param taskId - card identity.
   * @returns committed completed card or normalized failure.
   */
  approve(taskId: TaskBoardTaskId): Promise<TaskBoardClientResult<TaskBoardTask>> {
    return this.mutateTask(taskId, ref => this.remote.approve(ref))
  }

  /**
   * Reject reviewed output and start a feedback revision round.
   * @param taskId - card identity.
   * @param feedback - required review feedback.
   * @returns committed running card or normalized failure.
   */
  reject(taskId: TaskBoardTaskId, feedback: string): Promise<TaskBoardClientResult<TaskBoardTask>> {
    return this.mutateTask(taskId, ref => this.remote.reject(ref, { feedback }))
  }

  /**
   * Retry a failed card under the Host continuity policy.
   * @param taskId - card identity.
   * @param allowFreshSession - explicit permission to replace an unavailable Session.
   * @returns committed running card or normalized failure.
   */
  retry(taskId: TaskBoardTaskId, allowFreshSession: boolean): Promise<TaskBoardClientResult<TaskBoardTask>> {
    return this.mutateTask(taskId, ref => this.remote.retry(ref, { allowFreshSession }))
  }

  /**
   * Stop the active task round.
   * @param taskId - card identity.
   * @returns reconciled card or normalized failure.
   */
  stop(taskId: TaskBoardTaskId): Promise<TaskBoardClientResult<TaskBoardTask>> {
    return this.mutateTask(taskId, ref => this.remote.stop(ref))
  }

  /**
   * Reopen an approved card as initialized work.
   * @param taskId - card identity.
   * @returns committed initialized card or normalized failure.
   */
  reopen(taskId: TaskBoardTaskId): Promise<TaskBoardClientResult<TaskBoardTask>> {
    return this.mutateTask(taskId, ref => this.remote.reopen(ref))
  }

  /**
   * Delete one non-running card.
   * @param taskId - card identity.
   * @returns deletion receipt or normalized failure.
   */
  async delete(taskId: TaskBoardTaskId): Promise<TaskBoardClientResult<TaskBoardDeleteValue>> {
    const current = this.view.tasks.find(task => task.id === taskId)
    if (current === undefined) return notFound(taskId)
    this.setPending(taskId, true)
    try {
      const carried = await this.remote.delete({ id: taskId, revision: current.revision })
      if (!carried.ok) return { ok: false, error: carried.error }
      const result = carried.value
      if (!result.ok) {
        this.reconcileConflict(result.error)
        return result
      }
      this.patch({ tasks: this.view.tasks.filter(task => task.id !== taskId) })
      return result
    } catch (error) {
      return { ok: false, error: transportError(error) }
    } finally {
      this.setPending(taskId, false)
    }
  }

  /**
   * Optimistically move a card before another card in the same state.
   * @param taskId - moved card identity.
   * @param beforeTaskId - same-state anchor, or undefined to append.
   * @returns committed card or normalized failure.
   */
  async reorder(
    taskId: TaskBoardTaskId,
    beforeTaskId?: TaskBoardTaskId,
  ): Promise<TaskBoardClientResult<TaskBoardTask>> {
    const current = this.view.tasks.find(task => task.id === taskId)
    if (current === undefined) return notFound(taskId)
    const before = beforeTaskId === undefined
      ? undefined
      : this.view.tasks.find(task => task.id === beforeTaskId)
    if (before !== undefined && before.status !== current.status) {
      return {
        ok: false,
        error: { code: 'invalid-transition', status: current.status, operation: 'reorder' },
      }
    }

    const baselineRevision = this.view.boardRevision
    const baselineTasks = this.view.tasks
    const optimistic = this.optimisticOrder(current, beforeTaskId)
    this.patch({ tasks: optimistic })
    const result = await this.mutateTask(taskId, ref => this.remote.reorder(
      ref,
      beforeTaskId === undefined ? {} : { beforeTaskId },
    ))
    if (!result.ok) {
      if (this.view.boardRevision === baselineRevision) this.patch({ tasks: baselineTasks })
      else await this.refresh()
    }
    return result
  }

  /** Release subscribers and prevent later Remote completions from publishing. */
  dispose(): void {
    this.disposed = true
    this.listeners.clear()
  }

  private async readSnapshot(): Promise<TaskBoardClientResult<readonly TaskBoardTask[]>> {
    try {
      const carried = await this.remote.snapshot()
      if (!carried.ok) {
        this.patch({ status: 'error', error: carried.error })
        return { ok: false, error: carried.error }
      }
      const result = carried.value
      if (!result.ok) {
        this.patch({ status: 'error', error: result.error })
        return result
      }
      this.commit({
        ...this.view,
        status: 'ready',
        boardRevision: result.value.boardRevision,
        tasks: ordered(result.value.tasks),
        error: null,
      })
      return { ok: true, value: result.value.tasks }
    } catch (error) {
      const failure = transportError(error)
      this.patch({ status: 'error', error: failure })
      return { ok: false, error: failure }
    }
  }

  private async mutateTask(
    taskId: TaskBoardTaskId,
    invoke: (ref: TaskBoardTaskRef) => Promise<RemoteResult<TaskBoardTaskResult>>,
  ): Promise<TaskBoardClientResult<TaskBoardTask>> {
    const current = this.view.tasks.find(task => task.id === taskId)
    if (current === undefined) return notFound(taskId)
    this.setPending(taskId, true)
    try {
      const carried = await invoke({ id: taskId, revision: current.revision })
      if (!carried.ok) return { ok: false, error: carried.error }
      const result = carried.value
      if (!result.ok) {
        this.reconcileConflict(result.error)
        return result
      }
      this.replaceTask(result.value)
      return result
    } catch (error) {
      return { ok: false, error: transportError(error) }
    } finally {
      this.setPending(taskId, false)
    }
  }

  private reconcileConflict(error: TaskBoardFailureResult): void {
    if (error.code === 'revision-conflict') this.replaceTask(error.current)
  }

  private optimisticOrder(task: TaskBoardTask, beforeTaskId?: TaskBoardTaskId): readonly TaskBoardTask[] {
    const peers = this.view.tasks.filter(item => item.status === task.status && item.id !== task.id)
    const anchor = beforeTaskId === undefined
      ? peers.length
      : peers.findIndex(item => item.id === beforeTaskId)
    peers.splice(anchor < 0 ? peers.length : anchor, 0, task)
    let peerIndex = 0
    return this.view.tasks.map((item) => {
      if (item.status !== task.status) return item
      return peers[peerIndex++] as TaskBoardTask
    })
  }

  private replaceTask(task: TaskBoardTask): void {
    const observed = this.view.tasks.find(item => item.id === task.id)
    if (observed !== undefined && observed.revision > task.revision) return
    this.patch({ tasks: this.upsert(this.view.tasks, task) })
  }

  private upsert(tasks: readonly TaskBoardTask[], task: TaskBoardTask): readonly TaskBoardTask[] {
    const index = tasks.findIndex(item => item.id === task.id)
    if (index < 0) return ordered([...tasks, task])
    const next = [...tasks]
    next[index] = task
    return ordered(next)
  }

  private setPending(taskId: TaskBoardTaskId, pending: boolean): void {
    const current = this.view.pendingTaskIds
    if (pending) {
      const count = this.pendingTaskCounts.get(taskId) ?? 0
      this.pendingTaskCounts.set(taskId, count + 1)
      if (count === 0) this.patch({ pendingTaskIds: [...current, taskId] })
      return
    }
    const count = this.pendingTaskCounts.get(taskId) as number
    if (count > 1) {
      this.pendingTaskCounts.set(taskId, count - 1)
      return
    }
    this.pendingTaskCounts.delete(taskId)
    this.patch({ pendingTaskIds: current.filter(id => id !== taskId) })
  }

  private patch(patch: Partial<TaskBoardClientView>): void {
    this.commit({ ...this.view, ...patch })
  }

  private commit(next: TaskBoardClientView): void {
    if (this.disposed) return
    this.view = next
    for (const listener of this.listeners) listener()
  }
}
