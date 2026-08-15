/** Durable reviewed task cards and Harness Session orchestration service. @module @deepseek-ai/dsh-task-board */

import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import { AttachmentError } from '@deepseek-ai/dsh-attachment'
import {
  SessionId,
  type SessionEvent,
  type TurnEndReason,
} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { DomainGlobal, KvTable } from '@deepseek-ai/dsh-storage-domain'
import {
  TaskBoardSessionRequestId,
  type TaskBoardSessionContentPart,
  type TaskBoardSessionFailure,
} from './session-types.ts'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { taskBoardDomainSpec } from './spec.ts'
import type { TaskBoardGlobal } from './spec.ts'
import {
  approveTaskRecord,
  appendPromptRecord,
  composeInitialPrompt,
  createTaskRecord,
  deleteAllowed,
  editTaskRecord,
  failRoundAdmissionRecord,
  markRoundRunningRecord,
  projectRoundOutcome,
  reconcileRound,
  recordRoundEvidence,
  rejectTaskRecord,
  requestStopRecord,
  reopenTaskRecord,
  reorderTaskRecord,
  retryTaskRecord,
  rollbackPromptRecord,
  snapshotBoard,
  snapshotTask,
  startRoundRecord,
  TaskBoardStateError,
} from './state.ts'
import type { TaskBoardPromptEvidence, TaskBoardRoundProjection } from './state.ts'
import type {
  TaskBoardActivityId,
  TaskBoardAttachmentResult,
  TaskBoardAttachmentUploadRequest,
  TaskBoardChange,
  TaskBoardCreateRequest,
  TaskBoardDeleteResult,
  TaskBoardDeleteValue,
  TaskBoardEditPatch,
  TaskBoardFailure,
  TaskBoardFailureResult,
  TaskBoardFollowupRequest,
  TaskBoardPromptId,
  TaskBoardRejectRequest,
  TaskBoardRejected,
  TaskBoardReorderRequest,
  TaskBoardResult,
  TaskBoardRetryRequest,
  TaskBoardRoundId,
  TaskBoardSnapshotResult,
  TaskBoardSuccess,
  TaskBoardTask,
  TaskBoardTaskId,
  TaskBoardTaskRef,
  TaskBoardTaskResult,
} from '../types.ts'

export type * from '../types.ts'
export {
  taskBoardActivitySchema,
  taskBoardDomainSpec,
  taskBoardFailureSchema,
  taskBoardGlobalSchema,
  taskBoardRoundPromptSchema,
  taskBoardRoundSchema,
  taskBoardTaskSchema,
} from './spec.ts'
export type { TaskBoardGlobal } from './spec.ts'

/** Required deployment-varying task text and automatic-title limits. */
export interface Config {
  /** Maximum Unicode code points retained in an automatic title. */
  readonly automaticTitleMaxChars: number
  /** Maximum UTF-8 byte length accepted for a manual title. */
  readonly maxTitleBytes: number
  /** Maximum UTF-8 byte length accepted for a task description. */
  readonly maxDescriptionBytes: number
  /** Maximum UTF-8 byte length accepted for acceptance criteria. */
  readonly maxAcceptanceCriteriaBytes: number
  /** Maximum UTF-8 byte length accepted for rejection feedback. */
  readonly maxFeedbackBytes: number
  /** Maximum UTF-8 byte length accepted for a running follow-up. */
  readonly maxFollowupBytes: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    taskBoard: TaskBoardService
  }
}

interface ResolvedText {
  readonly ok: true
  readonly value: string
}

type TextResolution = ResolvedText | TaskBoardRejected

function success<T>(value: T): TaskBoardSuccess<T> {
  return { ok: true, value }
}

function decodeAttachmentData(data: string): Uint8Array | undefined {
  if (data.length === 0) return undefined
  const decoded = Buffer.from(data, 'base64')
  return decoded.toString('base64') === data ? new Uint8Array(decoded) : undefined
}

function rejected(error: TaskBoardFailureResult): TaskBoardRejected {
  return { ok: false, error }
}

function positiveSafeInteger(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`task-board: ${name} must be a positive safe integer, got ${String(value)}`)
  }
  return value
}

function taskId(): TaskBoardTaskId {
  return randomUUID() as TaskBoardTaskId
}

function activityId(): TaskBoardActivityId {
  return randomUUID() as TaskBoardActivityId
}

function roundId(): TaskBoardRoundId {
  return randomUUID() as TaskBoardRoundId
}

function promptId(): TaskBoardPromptId {
  return randomUUID() as TaskBoardPromptId
}

function sessionId(): SessionId {
  return SessionId(`task-board-${randomUUID()}`)
}

function rpcId(): TaskBoardSessionRequestId {
  return TaskBoardSessionRequestId(randomUUID())
}

function initialPosition(sequence: number): string {
  const value = sequence * 1_000_000
  if (!Number.isSafeInteger(value)) throw new Error('task-board: sequence exceeds ordering range')
  return String(value).padStart(16, '0')
}

/** Host authority for durable task cards and public `taskBoard` Remote methods. */
export class TaskBoardService extends TypertRemoteService {
  static inject = [
    'agents',
    'attachments',
    'sessionPersistence',
    'sessions',
    'storageDomain',
    'taskBoardSession',
  ]

  /** Loader validation for every deployment-varying text limit. */
  static Config: s<Config> = s.object({
    automaticTitleMaxChars: s.number().step(1).min(1).required(),
    maxTitleBytes: s.number().step(1).min(1).required(),
    maxDescriptionBytes: s.number().step(1).min(1).required(),
    maxAcceptanceCriteriaBytes: s.number().step(1).min(1).required(),
    maxFeedbackBytes: s.number().step(1).min(1).required(),
    maxFollowupBytes: s.number().step(1).min(1).required(),
  })

  private readonly config: Config
  private global?: DomainGlobal<TaskBoardGlobal>
  private tasks?: KvTable<TaskBoardTaskId, TaskBoardTask>
  private boardTail: Promise<void> = Promise.resolve()
  private readonly taskTails = new Map<TaskBoardTaskId, Promise<void>>()
  private readonly activeSessions = new Map<SessionId, TaskBoardTaskId>()
  private mutationAdmissionOpen = true

  /**
   * @param ctx - Host context carrying the Storage Domain facility.
   * @param config - Required text and automatic-title limits.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'taskBoard')
    this.config = {
      automaticTitleMaxChars: positiveSafeInteger('automaticTitleMaxChars', config.automaticTitleMaxChars),
      maxTitleBytes: positiveSafeInteger('maxTitleBytes', config.maxTitleBytes),
      maxDescriptionBytes: positiveSafeInteger('maxDescriptionBytes', config.maxDescriptionBytes),
      maxAcceptanceCriteriaBytes: positiveSafeInteger(
        'maxAcceptanceCriteriaBytes',
        config.maxAcceptanceCriteriaBytes,
      ),
      maxFeedbackBytes: positiveSafeInteger('maxFeedbackBytes', config.maxFeedbackBytes),
      maxFollowupBytes: positiveSafeInteger('maxFollowupBytes', config.maxFollowupBytes),
    }
  }

  /** Open and own the task-board Storage Domain. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(taskBoardDomainSpec)
    this.global = domain.global
    this.tasks = domain.table('tasks')
    this.rebuildActiveSessions()
    this.ctx.on('session/event', (session) => {
      this.scheduleReconcile(session.id)
    }, { global: true })
    this.ctx.on('agent/status', ({ agent, status }) => {
      if (status === 'idle') this.scheduleReconcile(agent.id)
    }, { global: true })
    this.ctx.effect(() => async () => {
      this.mutationAdmissionOpen = false
      await Promise.all([...this.taskTails.values(), this.boardTail])
      await domain.close()
    }, 'task-board.domainClose')
    for (const activeSessionId of this.activeSessions.keys()) this.scheduleReconcile(activeSessionId)
  }

  /**
   * Read the authoritative board after all previously admitted commits.
   * @returns Immutable board snapshot and committed global revision.
   */
  @Remote('snapshot') snapshot(): Promise<TaskBoardSnapshotResult> {
    return this.enqueueBoard(() => Promise.resolve(success(snapshotBoard(
      [...this.requireTasks().entries()].map(([, task]) => task),
      this.requireGlobal().get().boardRevision,
    ))))
  }

  /**
   * Validate and persist one browser-staged task image.
   * @param request - Canonical base64 bytes, declared media type, and optional display name.
   * @returns Durable image reference or a correction-oriented request failure.
   */
  @Remote('uploadAttachment') async uploadAttachment(
    request: TaskBoardAttachmentUploadRequest,
  ): Promise<TaskBoardAttachmentResult> {
    const data = decodeAttachmentData(request.data)
    if (data === undefined) {
      return this.invalidRequest('attachment', 'Image upload must use canonical base64.')
    }
    try {
      const attachment = await this.ctx.attachments.saveImage({
        data,
        mediaType: request.mediaType,
        ...(request.name === undefined ? {} : { name: request.name }),
      })
      return success(attachment)
    } catch (error) {
      return rejected({
        code: 'attachment-error',
        reason: error instanceof AttachmentError ? error.code : 'ATTACHMENT_STORE_FAILED',
        message: error instanceof AttachmentError ? error.message : 'Image upload could not be stored.',
      })
    }
  }

  /**
   * Create one durable initialized card and optionally start it.
   * @param request - Validated task content, placement, and start intent.
   * @returns Committed card or a stable request failure.
   */
  @Remote('create') async create(request: TaskBoardCreateRequest): Promise<TaskBoardTaskResult> {
    const valid = this.validateCreate(request)
    if (!valid.ok) return valid
    const created = await this.enqueueBoard(async () => {
      const currentGlobal = this.requireGlobal().get()
      const task = createTaskRecord(request, {
        id: taskId(),
        sequence: currentGlobal.nextSequence,
        position: initialPosition(currentGlobal.nextSequence),
        activityId: activityId(),
        now: Date.now(),
        automaticTitleMaxChars: this.config.automaticTitleMaxChars,
      })
      const boardRevision = currentGlobal.boardRevision + 1
      await this.requireGlobal().set({
        nextSequence: currentGlobal.nextSequence + 1,
        boardRevision,
      })
      await this.requireTasks().put(task.id, task)
      this.refreshActiveSession(task)
      this.emitChange({ boardRevision, operation: 'created', taskId: task.id, task })
      return success(snapshotTask(task))
    })
    if (!request.start) return created
    return this.start({ id: created.value.id, revision: created.value.revision })
  }

  /**
   * Replace material card fields after a compare-and-set revision check.
   * @param ref - Task identity and observed revision.
   * @param patch - Fields to replace, clear, or reset to automatic title.
   * @returns Committed card, current conflict value, or stable request failure.
   */
  @Remote('edit') edit(ref: TaskBoardTaskRef, patch: TaskBoardEditPatch): Promise<TaskBoardTaskResult> {
    const validPatch = this.validateEditPatch(patch)
    if (!validPatch.ok) return Promise.resolve(validPatch)
    return this.enqueueTask(ref.id, () => this.enqueueBoard(async () => {
      const current = this.resolveRef(ref)
      if (!current.ok) return current
      const description = patch.description ?? current.value.description
      const criteria = patch.acceptanceCriteria ?? current.value.acceptanceCriteria
      if (description.trim().length === 0 && criteria.trim().length === 0) {
        return this.invalidRequest('description', 'description and acceptanceCriteria cannot both be blank')
      }
      let next: TaskBoardTask
      try {
        next = editTaskRecord(
          current.value,
          patch,
          { activityId: activityId(), now: Date.now() },
          this.config.automaticTitleMaxChars,
        )
      } catch (error) {
        if (!(error instanceof TaskBoardStateError)) throw error
        return this.invalidRequest('patch', error.message)
      }
      if (next === current.value) return success(snapshotTask(current.value))
      return success(await this.commitTask(next, 'updated'))
    }, true))
  }

  /**
   * Move a card before another card in the same workflow state.
   * @param ref - Task identity and observed revision.
   * @param request - Optional same-column anchor; omission appends.
   * @returns Committed moved task or stable rejection.
   */
  @Remote('reorder') reorder(
    ref: TaskBoardTaskRef,
    request: TaskBoardReorderRequest,
  ): Promise<TaskBoardTaskResult> {
    return this.enqueueTask(ref.id, () => this.enqueueBoard(async () => {
      const current = this.resolveRef(ref)
      if (!current.ok) return current
      const siblings = [...this.requireTasks().entries()]
        .map(([, task]) => task)
        .filter(task => task.status === current.value.status)
      let result
      try {
        result = reorderTaskRecord(current.value, siblings, request, { now: Date.now() })
      } catch (error) {
        if (!(error instanceof TaskBoardStateError)) throw error
        return this.invalidRequest(
          'beforeTaskId',
          error.message,
        )
      }
      for (const changed of result.changed) await this.commitTask(changed, 'updated')
      const committed = this.requireTasks().get(ref.id)
      if (committed === undefined) throw new Error(`task-board: reordered task '${ref.id}' disappeared`)
      return success(snapshotTask(committed))
    }, true))
  }

  /**
   * Start an initialized card in a newly created Harness Session.
   * @param ref - Task identity and observed revision.
   * @returns Running task after prompt admission, or a stable rejection.
   */
  @Remote('start') start(ref: TaskBoardTaskRef): Promise<TaskBoardTaskResult> {
    return this.enqueueTask(ref.id, async () => {
      const current = this.resolveRef(ref)
      if (!current.ok) return current
      const nextSessionId = sessionId()
      const nextPromptId = promptId()
      const nextPromptRpcId = rpcId()
      let starting: TaskBoardTask
      try {
        starting = startRoundRecord(current.value, {
          roundId: roundId(),
          sessionId: nextSessionId,
          trigger: 'initial',
          prompt: {
            id: nextPromptId,
            rpcId: nextPromptRpcId,
            kind: 'initial',
            text: composeInitialPrompt(current.value),
            acceptedAt: Date.now(),
          },
          activityId: activityId(),
          now: Date.now(),
        })
      } catch (error) {
        return this.stateRejection(current.value, 'start', error)
      }
      await this.persistUpdatedTask(starting)
      return this.admitPreparedRound(starting.id, {
        createSession: true,
        promptRpcId: nextPromptRpcId,
        promptText: composeInitialPrompt(starting),
        includeInitialAttachments: true,
      })
    })
  }

  /**
   * Append a non-blank instruction to the current active round.
   * @param ref - Task identity and observed revision.
   * @param request - Follow-up text admitted through the ordinary Session API.
   * @returns Updated running task or prompt rejection.
   */
  @Remote('followup') followup(
    ref: TaskBoardTaskRef,
    request: TaskBoardFollowupRequest,
  ): Promise<TaskBoardTaskResult> {
    const text = this.resolveText('text', request.text, this.config.maxFollowupBytes, false)
    if (!text.ok) return Promise.resolve(text)
    return this.enqueueTask(ref.id, async () => {
      const current = this.resolveSessionRef(ref, 'followup')
      if (!current.ok) return current
      const { sessionId: currentSessionId, task } = current.value
      const nextPromptId = promptId()
      const nextRpcId = rpcId()
      let staged: TaskBoardTask
      try {
        staged = appendPromptRecord(task, {
          id: nextPromptId,
          rpcId: nextRpcId,
          kind: 'followup',
          text: text.value,
          acceptedAt: Date.now(),
        }, { activityId: activityId(), now: Date.now() })
      } catch (error) {
        return this.stateRejection(task, 'followup', error)
      }
      await this.persistUpdatedTask(staged)
      let failure: TaskBoardFailure | undefined
      try {
        const response = await this.ctx.taskBoardSession.prompt({
          requestId: nextRpcId,
          sessionId: currentSessionId,
          content: [{ type: 'text', text: text.value }],
        })
        if (!response.ok) failure = this.rpcFailure('prompt-admission', response.error)
      } catch {
        failure = {
          stage: 'prompt-admission',
          code: 'PROMPT_ADMISSION_FAILED',
          message: 'The follow-up prompt could not be admitted.',
        }
      }
      if (failure !== undefined) {
        const latest = this.requireTask(staged.id)
        await this.persistUpdatedTask(rollbackPromptRecord(latest, nextPromptId, Date.now()))
        return rejected({ code: 'prompt-rejected', failure })
      }
      return success(this.getRequiredTask(staged.id))
    })
  }

  /**
   * Reject reviewed output with required feedback and continue the same Session.
   * @param ref - Reviewed task identity and observed revision.
   * @param request - Required human feedback sent to the Agent.
   * @returns Running revision round or stable rejection.
   */
  @Remote('reject') reject(
    ref: TaskBoardTaskRef,
    request: TaskBoardRejectRequest,
  ): Promise<TaskBoardTaskResult> {
    const feedback = this.resolveText('feedback', request.feedback, this.config.maxFeedbackBytes, false)
    if (!feedback.ok) return Promise.resolve(feedback)
    return this.enqueueTask(ref.id, async () => {
      const current = this.resolveSessionRef(ref, 'reject')
      if (!current.ok) return current
      const { task } = current.value
      const nextRpcId = rpcId()
      let starting: TaskBoardTask
      try {
        starting = rejectTaskRecord(task, {
          feedback: feedback.value,
          roundId: roundId(),
          promptId: promptId(),
          rpcId: nextRpcId,
          activityId: activityId(),
          now: Date.now(),
        })
      } catch (error) {
        return this.stateRejection(task, 'reject', error)
      }
      await this.persistUpdatedTask(starting)
      return this.admitPreparedRound(starting.id, {
        createSession: false,
        promptRpcId: nextRpcId,
        promptText: feedback.value,
        includeInitialAttachments: false,
      })
    })
  }

  /**
   * Start exactly one user-requested retry round.
   * @param ref - Failed task identity and observed revision.
   * @param request - Permission to replace an unavailable Session.
   * @returns Running retry, `fresh-session-required`, or stable rejection.
   */
  @Remote('retry') retry(
    ref: TaskBoardTaskRef,
    request: TaskBoardRetryRequest,
  ): Promise<TaskBoardTaskResult> {
    return this.enqueueTask(ref.id, async () => {
      const current = this.resolveRef(ref)
      if (!current.ok) return current
      if (current.value.status !== 'failed') {
        return rejected({ code: 'invalid-transition', status: current.value.status, operation: 'retry' })
      }
      const previousSessionId = current.value.currentSessionId
      const resumableSessionId = previousSessionId === undefined
        || this.ctx.agents.get(previousSessionId) === undefined
        ? undefined
        : previousSessionId
      if (resumableSessionId === undefined && previousSessionId !== undefined && !request.allowFreshSession) {
        return rejected({ code: 'fresh-session-required', sessionId: previousSessionId })
      }
      const retrySessionId = resumableSessionId ?? sessionId()
      const createSession = resumableSessionId === undefined
      const nextRpcId = rpcId()
      const text = `Retry the task after the previous execution failed.\n\n${composeInitialPrompt(current.value)}`
      let starting: TaskBoardTask
      try {
        starting = retryTaskRecord(current.value, {
          sessionId: retrySessionId,
          roundId: roundId(),
          promptId: promptId(),
          rpcId: nextRpcId,
          text,
          activityId: activityId(),
          now: Date.now(),
        })
      } catch (error) {
        return this.stateRejection(current.value, 'retry', error)
      }
      await this.persistUpdatedTask(starting)
      return this.admitPreparedRound(starting.id, {
        createSession,
        promptRpcId: nextRpcId,
        promptText: text,
        includeInitialAttachments: false,
      })
    })
  }

  /**
   * Cancel an active Session turn and wait for its durable terminal evidence.
   * @param ref - Running task identity and observed revision.
   * @returns Reconciled failed card or stable cancellation rejection.
   */
  @Remote('stop') stop(ref: TaskBoardTaskRef): Promise<TaskBoardTaskResult> {
    return this.enqueueTask(ref.id, async () => {
      const current = this.resolveSessionRef(ref, 'stop')
      if (!current.ok) return current
      const { sessionId: currentSessionId, task } = current.value
      let stopping: TaskBoardTask
      try {
        stopping = requestStopRecord(task, { activityId: activityId(), now: Date.now() })
      } catch (error) {
        return this.stateRejection(task, 'stop', error)
      }
      await this.persistUpdatedTask(stopping)
      let response
      try {
        response = await this.ctx.taskBoardSession.cancel({
          requestId: rpcId(),
          sessionId: currentSessionId,
        })
      } catch {
        return rejected({ code: 'session-unavailable', sessionId: currentSessionId })
      }
      if (!response.ok) {
        return rejected({ code: 'session-unavailable', sessionId: currentSessionId })
      }
      await this.ctx.agents.get(currentSessionId)?.whenIdle()
      await this.reconcileTaskNow(stopping.id)
      return success(this.getRequiredTask(stopping.id))
    })
  }

  /**
   * Mark a successfully executed reviewed task complete.
   * @param ref - Task identity and observed revision.
   * @returns Committed completed card or stable transition failure.
   */
  @Remote('approve') approve(ref: TaskBoardTaskRef): Promise<TaskBoardTaskResult> {
    return this.mutateOne(ref, 'approve', task => approveTaskRecord(task, {
      activityId: activityId(),
      now: Date.now(),
    }))
  }

  /**
   * Reopen an approved card as initialized work while retaining its history.
   * @param ref - Task identity and observed revision.
   * @returns Committed initialized card or stable transition failure.
   */
  @Remote('reopen') reopen(ref: TaskBoardTaskRef): Promise<TaskBoardTaskResult> {
    return this.mutateOne(ref, 'reopen', task => reopenTaskRecord(task, {
      activityId: activityId(),
      now: Date.now(),
    }))
  }

  /**
   * Delete a non-running card without deleting linked Sessions or attachments.
   * @param ref - Task identity and observed revision after any Client confirmation.
   * @returns Durable deletion acknowledgement or stable rejection.
   */
  @Remote('delete') delete(ref: TaskBoardTaskRef): Promise<TaskBoardDeleteResult> {
    return this.enqueueTask(ref.id, () => this.enqueueBoard(async () => {
      const current = this.resolveRef(ref)
      if (!current.ok) return current
      if (!deleteAllowed(current.value, true)) {
        return rejected({ code: 'invalid-transition', status: current.value.status, operation: 'delete' })
      }
      const global = this.requireGlobal().get()
      const boardRevision = global.boardRevision + 1
      await this.requireGlobal().set({ ...global, boardRevision })
      const deleted = await this.requireTasks().delete(ref.id)
      if (!deleted) throw new Error(`task-board: committed task '${ref.id}' disappeared before deletion`)
      this.emitChange({ boardRevision, operation: 'deleted', taskId: ref.id })
      this.removeActiveSession(ref.id)
      return success<TaskBoardDeleteValue>({ deleted: true, taskId: ref.id })
    }, true))
  }

  /**
   * Read one task synchronously from committed domain memory.
   * @param id - Stable task identity.
   * @returns Detached immutable task, or `undefined` when absent.
   */
  getTask(id: TaskBoardTaskId): TaskBoardTask | undefined {
    const task = this.requireTasks().get(id)
    return task === undefined ? undefined : snapshotTask(task)
  }

  /**
   * Read every committed task for package-owned invariant checks.
   * @returns Detached immutable tasks in storage iteration order.
   */
  inspectTasks(): readonly TaskBoardTask[] {
    return [...this.requireTasks().entries()].map(([, task]) => snapshotTask(task))
  }

  /**
   * Read the global revision used to validate emitted board changes.
   * @returns Current committed global board revision.
   */
  currentBoardRevision(): number {
    return this.requireGlobal().get().boardRevision
  }

  /**
   * Wait until operations already admitted for one task and the board have settled.
   * @param id - Task whose operation tail should be observed.
   * @returns Resolution after current tails settle; later operations are not included.
   */
  async whenSettled(id: TaskBoardTaskId): Promise<void> {
    await Promise.all([this.taskTails.get(id) ?? Promise.resolve(), this.boardTail])
  }

  private validateCreate(request: TaskBoardCreateRequest): TextResolution {
    if (request.workspaceId !== undefined && request.cwd !== undefined) {
      return this.invalidRequest('cwd', 'workspaceId and cwd cannot both be supplied')
    }
    const title = this.resolveText('title', request.title ?? '', this.config.maxTitleBytes, true)
    if (!title.ok) return title
    const description = this.resolveText(
      'description',
      request.description,
      this.config.maxDescriptionBytes,
      true,
    )
    if (!description.ok) return description
    const criteria = this.resolveText(
      'acceptanceCriteria',
      request.acceptanceCriteria,
      this.config.maxAcceptanceCriteriaBytes,
      true,
    )
    if (!criteria.ok) return criteria
    if (description.value.trim().length === 0 && criteria.value.trim().length === 0) {
      return this.invalidRequest('description', 'description and acceptanceCriteria cannot both be blank')
    }
    return { ok: true, value: '' }
  }

  private validateEditPatch(patch: TaskBoardEditPatch): TextResolution {
    if (patch.workspaceId != null && patch.cwd != null) {
      return this.invalidRequest('cwd', 'workspaceId and cwd cannot both be supplied')
    }
    const fields: ReadonlyArray<readonly [string, string | undefined, number]> = [
      ['title', patch.title, this.config.maxTitleBytes],
      ['description', patch.description, this.config.maxDescriptionBytes],
      ['acceptanceCriteria', patch.acceptanceCriteria, this.config.maxAcceptanceCriteriaBytes],
    ]
    for (const [field, value, maxBytes] of fields) {
      if (value === undefined) continue
      const resolution = this.resolveText(field, value, maxBytes, true)
      if (!resolution.ok) return resolution
    }
    return { ok: true, value: '' }
  }

  private resolveText(field: string, value: string, maxBytes: number, allowBlank: boolean): TextResolution {
    if (!allowBlank && value.trim().length === 0) return this.invalidRequest(field, `${field} cannot be blank`)
    const actualBytes = Buffer.byteLength(value, 'utf8')
    if (actualBytes > maxBytes) {
      return this.invalidRequest(field, `${field} exceeds ${maxBytes} UTF-8 bytes`)
    }
    return { ok: true, value }
  }

  private invalidRequest(field: string, message: string): TaskBoardRejected {
    return rejected({ code: 'invalid-request', field, message })
  }

  private resolveRef(ref: TaskBoardTaskRef): TaskBoardResult<TaskBoardTask> {
    const current = this.requireTasks().get(ref.id)
    if (current === undefined) return rejected({ code: 'task-not-found', taskId: ref.id })
    if (current.revision !== ref.revision) {
      return rejected({ code: 'revision-conflict', current: snapshotTask(current) })
    }
    return success(current)
  }

  private resolveSessionRef(
    ref: TaskBoardTaskRef,
    operation: string,
  ): TaskBoardResult<{ readonly sessionId: SessionId; readonly task: TaskBoardTask }> {
    const current = this.resolveRef(ref)
    if (!current.ok) return current
    const currentSessionId = current.value.currentSessionId
    if (currentSessionId === undefined) {
      return rejected({ code: 'invalid-transition', status: current.value.status, operation })
    }
    return success({ sessionId: currentSessionId, task: current.value })
  }

  private mutateOne(
    ref: TaskBoardTaskRef,
    operation: string,
    mutate: (task: TaskBoardTask) => TaskBoardTask,
  ): Promise<TaskBoardTaskResult> {
    return this.enqueueTask(ref.id, () => this.enqueueBoard(async () => {
      const current = this.resolveRef(ref)
      if (!current.ok) return current
      let next: TaskBoardTask
      try {
        next = mutate(current.value)
      } catch (error) {
        if (!(error instanceof TaskBoardStateError)) throw error
        return rejected({ code: 'invalid-transition', status: current.value.status, operation })
      }
      return success(await this.commitTask(next, 'updated'))
    }, true))
  }

  private async commitTask(task: TaskBoardTask, operation: 'created' | 'updated'): Promise<TaskBoardTask> {
    const global = this.requireGlobal().get()
    const boardRevision = global.boardRevision + 1
    await this.requireGlobal().set({ ...global, boardRevision })
    await this.requireTasks().put(task.id, task)
    this.refreshActiveSession(task)
    this.emitChange({ boardRevision, operation, taskId: task.id, task })
    return snapshotTask(task)
  }

  private emitChange(change: TaskBoardChange): void {
    try {
      this.ctx.emit('task-board/changed', change)
    } catch (error) {
      this.ctx.logger.warn(`task-board: task-board/changed listener failed: ${String(error)}`)
    }
  }

  private async persistUpdatedTask(task: TaskBoardTask): Promise<TaskBoardTask> {
    return this.enqueueBoard(() => this.commitTask(task, 'updated'), true)
  }

  private async admitPreparedRound(
    id: TaskBoardTaskId,
    options: {
      readonly createSession: boolean
      readonly promptRpcId: TaskBoardSessionRequestId
      readonly promptText: string
      readonly includeInitialAttachments: boolean
    },
  ): Promise<TaskBoardTaskResult> {
    let task = this.requireTask(id)
    const currentSessionId = task.currentSessionId
    if (currentSessionId === undefined) {
      throw new Error(`task-board: starting task '${id}' has no current Session`)
    }
    if (options.createSession) {
      let response
      try {
        response = await this.ctx.taskBoardSession.create({
          requestId: rpcId(),
          sessionId: currentSessionId,
          ...(task.workspaceId === undefined ? {} : { workspaceId: task.workspaceId }),
          ...(task.cwd === undefined ? {} : { cwd: task.cwd }),
          ...(task.agentPreset === undefined ? {} : { agentPreset: task.agentPreset }),
        })
      } catch {
        return this.failAdmission(id, {
          stage: 'session-create',
          code: 'SESSION_CREATE_FAILED',
          message: 'The Session could not be created.',
        })
      }
      if (!response.ok) {
        return this.failAdmission(id, this.rpcFailure('session-create', response.error))
      }
    }

    const content: TaskBoardSessionContentPart[] = [{ type: 'text', text: options.promptText }]
    if (options.includeInitialAttachments) {
      try {
        for (const attachment of task.attachments) {
          const stored = await this.ctx.attachments.readImage(attachment)
          content.push({
            type: 'image',
            mediaType: stored.ref.mediaType,
            data: Buffer.from(stored.data).toString('base64'),
            ...(stored.ref.name === undefined ? {} : { name: stored.ref.name }),
          })
        }
      } catch {
        return this.failAdmission(id, {
          stage: 'prompt-admission',
          code: 'ATTACHMENT_READ_FAILED',
          message: 'One or more task attachments could not be read.',
        })
      }
    }

    let promptResponse
    try {
      promptResponse = await this.ctx.taskBoardSession.prompt({
        requestId: options.promptRpcId,
        sessionId: currentSessionId,
        content,
      })
    } catch {
      return this.failAdmission(id, {
        stage: 'prompt-admission',
        code: 'PROMPT_ADMISSION_FAILED',
        message: 'The task prompt could not be admitted.',
      })
    }
    if (!promptResponse.ok) {
      return this.failAdmission(id, this.rpcFailure('prompt-admission', promptResponse.error))
    }
    task = this.requireTask(id)
    const running = markRoundRunningRecord(task, { now: Date.now() })
    if (running !== task) await this.persistUpdatedTask(running)
    return success(this.getRequiredTask(id))
  }

  private async failAdmission(id: TaskBoardTaskId, failure: {
    readonly stage: 'session-create' | 'prompt-admission'
    readonly code: string
    readonly message: string
  }): Promise<TaskBoardTaskResult> {
    const failed = failRoundAdmissionRecord(this.requireTask(id), failure, {
      activityId: activityId(),
      now: Date.now(),
    })
    await this.persistUpdatedTask(failed)
    return rejected({ code: 'prompt-rejected', failure })
  }

  private rpcFailure(
    stage: 'session-create' | 'prompt-admission',
    error: TaskBoardSessionFailure,
  ): { readonly stage: 'session-create' | 'prompt-admission'; readonly code: string; readonly message: string } {
    return { stage, code: error.code, message: error.message }
  }

  private stateRejection(
    task: TaskBoardTask,
    operation: string,
    error: unknown,
  ): TaskBoardRejected {
    if (!(error instanceof TaskBoardStateError)) throw error
    return rejected({ code: 'invalid-transition', status: task.status, operation })
  }

  private scheduleReconcile(currentSessionId: SessionId): void {
    const id = this.activeSessions.get(currentSessionId)
    if (id === undefined || !this.mutationAdmissionOpen) return
    void this.enqueueTask(id, () => this.reconcileTaskNow(id)).catch((error: unknown) => {
      this.ctx.logger.warn(`task-board: Session reconciliation failed: ${String(error)}`)
    })
  }

  private async reconcileTaskNow(id: TaskBoardTaskId): Promise<void> {
    let task = this.requireTasks().get(id)
    if (task === undefined || task.status !== 'running' || task.currentSessionId === undefined) return
    let events: readonly SessionEvent[]
    try {
      const live = this.ctx.sessions.get(task.currentSessionId)
      events = live?.events ?? (await this.ctx.sessionPersistence.inspect(task.currentSessionId)).events
    } catch {
      const failed = reconcileRound(task, {
        kind: 'failed',
        failure: {
          stage: 'recovery',
          code: 'SESSION_HISTORY_UNAVAILABLE',
          message: 'The Session history could not be inspected.',
        },
      }, { activityId: activityId(), now: Date.now() })
      await this.persistUpdatedTask(failed)
      return
    }

    const projection = this.projectSessionEvidence(task, task.currentSessionId, events)
    const withEvidence = recordRoundEvidence(task, projection.evidence, Date.now())
    if (withEvidence !== task) {
      await this.persistUpdatedTask(withEvidence)
      task = withEvidence
    }
    if (projection.outcome.kind === 'running') return
    const terminal = reconcileRound(task, projection.outcome, {
      activityId: activityId(),
      now: Date.now(),
    })
    await this.persistUpdatedTask(terminal)
  }

  private projectSessionEvidence(
    task: TaskBoardTask,
    currentSessionId: SessionId,
    events: readonly SessionEvent[],
  ): { readonly evidence: readonly TaskBoardPromptEvidence[]; readonly outcome: TaskBoardRoundProjection } {
    const round = task.rounds.at(-1)
    if (round === undefined) return { evidence: [], outcome: { kind: 'running' } }
    const promptsByRpcId = new Map(round.prompts.map(prompt => [prompt.rpcId, prompt]))
    const matched = new Map<TaskBoardPromptId, Omit<TaskBoardPromptEvidence, 'turnEndSeq'>>()
    const endings = new Map<number, Extract<SessionEvent, { type: 'turn/end' }>>()
    let activeTurn: { readonly turn: number; readonly seq: number } | undefined
    for (const event of events) {
      switch (event.type) {
        case 'turn/start':
          activeTurn = { turn: event.data.turn, seq: event.seq }
          break
        case 'user/message': {
          const source = event.data.source
          if (
            activeTurn === undefined
            || source.kind !== 'user'
            || !('rpcId' in source)
            || typeof source.rpcId !== 'string'
          ) break
          const prompt = promptsByRpcId.get(TaskBoardSessionRequestId(source.rpcId))
          if (prompt !== undefined) {
            matched.set(prompt.id, {
              promptId: prompt.id,
              messageSeq: event.seq,
              turn: activeTurn.turn,
              turnStartSeq: activeTurn.seq,
            })
          }
          break
        }
        case 'turn/end':
          endings.set(event.data.turn, event)
          if (activeTurn?.turn === event.data.turn) activeTurn = undefined
          break
        default:
          break
      }
    }
    const evidence = round.prompts.flatMap((prompt) => {
      const item = matched.get(prompt.id)
      if (item === undefined) return []
      const ending = endings.get(item.turn)
      return [{ ...item, ...(ending === undefined ? {} : { turnEndSeq: ending.seq }) }]
    })
    const latestPrompt = round.prompts.at(-1)
    const latestEvidence = latestPrompt === undefined ? undefined : matched.get(latestPrompt.id)
    const ending = latestEvidence === undefined ? undefined : endings.get(latestEvidence.turn)
    const agent = this.ctx.agents.get(currentSessionId)
    if (evidence.length !== round.prompts.length
      || ending === undefined
      || (agent !== undefined && agent.status !== 'idle')) {
      return { evidence, outcome: { kind: 'running' } }
    }
    return { evidence, outcome: this.projectTurnEnd(ending.data.reason, ending.seq) }
  }

  private projectTurnEnd(reason: TurnEndReason, endSeq: number): TaskBoardRoundProjection {
    switch (reason.kind) {
      case 'completed':
        return projectRoundOutcome([{ kind: 'completed', endSeq }])
      case 'error':
        return projectRoundOutcome([{
          kind: 'error',
          endSeq,
          failure: {
            stage: 'execution',
            code: reason.error.code,
            message: 'Execution failed. Open the Session log for details.',
            seq: endSeq,
          },
        }])
      case 'aborted':
        return projectRoundOutcome([{
          kind: 'cancelled',
          endSeq,
          failure: {
            stage: 'execution',
            code: 'CANCELLED',
            message: 'Execution was stopped.',
            seq: endSeq,
          },
        }])
      case 'blocked':
        return projectRoundOutcome([{
          kind: 'error',
          endSeq,
          failure: { stage: 'execution', code: 'BLOCKED', message: 'Execution was blocked.', seq: endSeq },
        }])
      case 'max-tokens':
        return projectRoundOutcome([{
          kind: 'error',
          endSeq,
          failure: {
            stage: 'execution',
            code: 'MAX_TOKENS',
            message: 'Execution reached the output token limit.',
            seq: endSeq,
          },
        }])
      case 'interrupted':
        return projectRoundOutcome([{
          kind: 'error',
          endSeq,
          failure: {
            stage: 'recovery',
            code: 'INTERRUPTED',
            message: 'Execution was interrupted before shutdown completed.',
            seq: endSeq,
          },
        }])
      default:
        // TurnEndReasonMap is merge-extensible; unknown plugin reasons fail closed.
        return projectRoundOutcome([{
          kind: 'error',
          endSeq,
          failure: {
            stage: 'execution',
            code: 'UNKNOWN_TURN_END',
            message: 'Execution ended with an unsupported result.',
            seq: endSeq,
          },
        }])
    }
  }

  private rebuildActiveSessions(): void {
    this.activeSessions.clear()
    for (const [, task] of this.requireTasks().entries()) this.refreshActiveSession(task)
  }

  private refreshActiveSession(task: TaskBoardTask): void {
    this.removeActiveSession(task.id)
    if (task.status === 'running' && task.currentSessionId !== undefined) {
      this.activeSessions.set(task.currentSessionId, task.id)
    }
  }

  private removeActiveSession(id: TaskBoardTaskId): void {
    for (const [currentSessionId, task] of this.activeSessions) {
      if (task === id) this.activeSessions.delete(currentSessionId)
    }
  }

  private requireTask(id: TaskBoardTaskId): TaskBoardTask {
    const task = this.requireTasks().get(id)
    if (task === undefined) throw new Error(`task-board: task '${id}' disappeared`)
    return task
  }

  private getRequiredTask(id: TaskBoardTaskId): TaskBoardTask {
    return snapshotTask(this.requireTask(id))
  }

  private enqueueTask<T>(id: TaskBoardTaskId, operation: () => Promise<T>): Promise<T> {
    if (!this.mutationAdmissionOpen) return Promise.reject(new Error('task-board: service is disposing'))
    const previous = this.taskTails.get(id) ?? Promise.resolve()
    const result = previous.then(operation)
    const settled = result.then(() => {}, () => {})
    this.taskTails.set(id, settled)
    void settled.then(() => {
      if (this.taskTails.get(id) === settled) this.taskTails.delete(id)
    })
    return result
  }

  private enqueueBoard<T>(operation: () => Promise<T>, alreadyAdmitted = false): Promise<T> {
    if (!alreadyAdmitted && !this.mutationAdmissionOpen) {
      return Promise.reject(new Error('task-board: service is disposing'))
    }
    const result = this.boardTail.then(operation)
    this.boardTail = result.then(() => {}, () => {})
    return result
  }

  private requireGlobal(): DomainGlobal<TaskBoardGlobal> {
    if (this.global === undefined) throw new Error('task-board: service is not initialized')
    return this.global
  }

  private requireTasks(): KvTable<TaskBoardTaskId, TaskBoardTask> {
    if (this.tasks === undefined) throw new Error('task-board: service is not initialized')
    return this.tasks
  }
}

export default TaskBoardService
