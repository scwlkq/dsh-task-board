/** Pure task-board workflow, ordering, prompt, and snapshot helpers. @module @deepseek-ai/dsh-task-board/src/state */

import { snapshotJsonValue } from '@deepseek-ai/dsh-session'
import { deepFreeze } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TaskBoardSessionRequestId } from './session-types.ts'
import type {
  TaskBoardActivity,
  TaskBoardActivityId,
  TaskBoardCreateRequest,
  TaskBoardEditPatch,
  TaskBoardEditableField,
  TaskBoardFailure,
  TaskBoardPromptId,
  TaskBoardReorderRequest,
  TaskBoardRound,
  TaskBoardRoundId,
  TaskBoardRoundPrompt,
  TaskBoardRoundTrigger,
  TaskBoardSnapshot,
  TaskBoardStatus,
  TaskBoardTask,
  TaskBoardTaskId,
} from '../types.ts'

const POSITION_STEP = 1_000_000
const POSITION_WIDTH = 16
const STATUS_RANK: Readonly<Record<TaskBoardStatus, number>> = {
  initialized: 0,
  running: 1,
  review: 2,
  done: 3,
  failed: 4,
}

interface MutationMetadata {
  readonly activityId: TaskBoardActivityId
  readonly now: number
}

type TaskBoardRecordPatch = {
  readonly [Key in keyof TaskBoardTask]?: TaskBoardTask[Key] | undefined
}

/** Deterministic allocation supplied by the Host for task creation. */
export interface TaskBoardCreateMetadata extends MutationMetadata {
  readonly id: TaskBoardTaskId
  readonly sequence: number
  readonly position: string
  readonly automaticTitleMaxChars: number
}

/** Deterministic allocation supplied when a round starts. */
export interface TaskBoardStartRoundInput extends MutationMetadata {
  readonly roundId: TaskBoardRoundId
  readonly sessionId: SessionId
  readonly trigger: TaskBoardRoundTrigger
  readonly prompt: TaskBoardRoundPrompt
  readonly feedback?: string
}

/** Deterministic identifiers used when rejection starts a revision round. */
export interface TaskBoardRejectRecordInput extends MutationMetadata {
  readonly feedback: string
  readonly roundId: TaskBoardRoundId
  readonly promptId: TaskBoardPromptId
  readonly rpcId: TaskBoardSessionRequestId
}

/** Deterministic identifiers used when a user starts a retry round. */
export interface TaskBoardRetryRecordInput extends MutationMetadata {
  readonly sessionId: SessionId
  readonly roundId: TaskBoardRoundId
  readonly promptId: TaskBoardPromptId
  readonly rpcId: TaskBoardSessionRequestId
  readonly text: string
}

/** Terminal evidence reduced from one round's Session events. */
export type TaskBoardRoundOutcomeSignal =
  | { readonly kind: 'completed'; readonly endSeq?: number }
  | { readonly kind: 'error'; readonly failure: TaskBoardFailure; readonly endSeq?: number }
  | { readonly kind: 'cancelled'; readonly failure: TaskBoardFailure; readonly endSeq?: number }

/** Current workflow projection of a round's durable Session evidence. */
export type TaskBoardRoundProjection =
  | { readonly kind: 'running' }
  | { readonly kind: 'review'; readonly endSeq?: number }
  | { readonly kind: 'failed'; readonly failure: TaskBoardFailure; readonly endSeq?: number }
  | { readonly kind: 'cancelled'; readonly failure: TaskBoardFailure; readonly endSeq?: number }

/** Reorder result containing every record whose persisted position changed. */
export interface TaskBoardReorderResult {
  readonly task: TaskBoardTask
  readonly tasks: readonly TaskBoardTask[]
  readonly changed: readonly TaskBoardTask[]
}

/** Durable Session evidence matched to one board prompt. */
export interface TaskBoardPromptEvidence {
  readonly promptId: TaskBoardPromptId
  readonly messageSeq: number
  readonly turn: number
  readonly turnStartSeq: number
  readonly turnEndSeq?: number
}

/* v8 ignore next -- closed same-process unions make this diagnostic unreachable. */
function assertNever(value: never, subject: string): never {
  throw new Error(`unexpected ${subject}: ${String(value)}`)
}

/** Expected pure workflow rejection raised before a durable mutation. */
export class TaskBoardStateError extends Error {
  override readonly name = 'TaskBoardStateError'
}

function stateError(message: string): TaskBoardStateError {
  return new TaskBoardStateError(`task-board ${message}`)
}

function requireTransition(task: TaskBoardTask, status: TaskBoardStatus, operation: string): void {
  if (task.status !== status) {
    throw stateError(`invalid transition: cannot ${operation} from ${task.status}`)
  }
}

function derivedActivityId(id: TaskBoardActivityId, suffix: string): TaskBoardActivityId {
  return `${id}:${suffix}` as TaskBoardActivityId
}

function freezeTask(task: TaskBoardTask): TaskBoardTask {
  const snapshot = snapshotJsonValue(task)
  if (snapshot === undefined) throw stateError('task is not losslessly JSON serializable')
  return deepFreeze(snapshot)
}

function freezeSnapshot(snapshot: TaskBoardSnapshot): TaskBoardSnapshot {
  const value = snapshotJsonValue(snapshot)
  if (value === undefined) throw stateError('snapshot is not losslessly JSON serializable')
  return deepFreeze(value)
}

function nextTask(task: TaskBoardTask, now: number, patch: TaskBoardRecordPatch): TaskBoardTask {
  const candidate: Record<string, unknown> = {
    ...task,
    ...patch,
    revision: task.revision + 1,
    updatedAt: Math.max(now, task.updatedAt),
  }
  for (const key of ['workspaceId', 'cwd', 'agentPreset', 'currentSessionId', 'lastStartFailure', 'completedAt']) {
    if (candidate[key] === undefined) Reflect.deleteProperty(candidate, key)
  }
  return freezeTask(candidate as unknown as TaskBoardTask)
}

function transitionActivity(
  metadata: MutationMetadata,
  from: TaskBoardStatus,
  to: TaskBoardStatus,
): TaskBoardActivity {
  return {
    id: derivedActivityId(metadata.activityId, 'transition'),
    at: metadata.now,
    actor: 'system',
    operation: 'transition',
    from,
    to,
  }
}

function activeRound(task: TaskBoardTask): TaskBoardRound {
  const round = task.rounds.at(-1)
  if (round === undefined || (round.status !== 'starting' && round.status !== 'running')) {
    throw stateError('round is not active')
  }
  return round
}

function replaceLatestRound(task: TaskBoardTask, round: TaskBoardRound): readonly TaskBoardRound[] {
  /* v8 ignore next -- callers obtain `round` from activeRound on the same task. */
  if (task.rounds.length === 0) throw stateError('task has no execution round')
  return [...task.rounds.slice(0, -1), round]
}

function createRound(
  task: TaskBoardTask,
  input: TaskBoardStartRoundInput,
): TaskBoardRound {
  return {
    id: input.roundId,
    ordinal: task.rounds.length + 1,
    trigger: input.trigger,
    status: 'starting',
    originStatus: task.status as 'initialized' | 'review' | 'failed',
    sessionId: input.sessionId,
    prompts: [input.prompt],
    startedAt: input.now,
    ...(input.feedback === undefined ? {} : { feedback: input.feedback }),
  }
}

function validateStart(task: TaskBoardTask, trigger: TaskBoardRoundTrigger): void {
  const latest = task.rounds.at(-1)
  if (latest?.status === 'starting' || latest?.status === 'running') {
    throw stateError(`round already active: ${latest.id}`)
  }
  switch (trigger) {
    case 'initial':
      requireTransition(task, 'initialized', 'start')
      return
    case 'revision':
      requireTransition(task, 'review', 'reject')
      return
    case 'retry':
      requireTransition(task, 'failed', 'retry')
      return
    /* v8 ignore next -- TaskBoardRoundTrigger is a closed same-process union. */
    default:
      assertNever(trigger, 'round trigger')
  }
}

function automaticTitle(request: TaskBoardCreateRequest, maxChars: number): string {
  const source = request.description.trim() || request.acceptanceCriteria.trim()
  const firstLineEnd = source.search(/\r?\n/)
  const firstLine = firstLineEnd === -1 ? source : source.slice(0, firstLineEnd)
  return Array.from(firstLine).slice(0, maxChars).join('')
}

function positionNumber(position: string): number | undefined {
  if (!/^\d+$/.test(position)) return undefined
  const value = Number(position)
  return Number.isSafeInteger(value) && value > 0 ? value : undefined
}

function formatPosition(value: number): string {
  /* v8 ignore next -- callers pass bounded positive sums or one-based array indexes. */
  if (!Number.isSafeInteger(value) || value < 1) throw stateError('position must be a positive safe integer')
  return String(value).padStart(POSITION_WIDTH, '0')
}

function positionBetween(previous: string | undefined, next: string | undefined): string | undefined {
  const previousValue = previous === undefined ? 0 : positionNumber(previous)
  const nextValue = next === undefined ? undefined : positionNumber(next)
  if (previousValue === undefined || (next !== undefined && nextValue === undefined)) return undefined
  if (nextValue === undefined) {
    if (previousValue > Number.MAX_SAFE_INTEGER - POSITION_STEP) return undefined
    return formatPosition(previousValue + POSITION_STEP)
  }
  if (nextValue - previousValue <= 1) return undefined
  return formatPosition(previousValue + Math.floor((nextValue - previousValue) / 2))
}

function sameAttachments(
  left: TaskBoardTask['attachments'],
  right: TaskBoardTask['attachments'],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

/**
 * Create an initialized immutable record from already validated user input.
 * @param request - Initial task content and placement.
 * @param metadata - Host-owned identifiers, time, and title limit.
 * @returns Detached immutable task at revision zero.
 */
export function createTaskRecord(
  request: TaskBoardCreateRequest,
  metadata: TaskBoardCreateMetadata,
): TaskBoardTask {
  if (metadata.automaticTitleMaxChars < 1) throw stateError('automatic title limit must be positive')
  if (request.workspaceId !== undefined && request.cwd !== undefined) {
    throw stateError('task may select a Workspace or cwd, not both')
  }
  const manualTitle = request.title !== undefined && request.title.trim().length > 0
  const title = request.title !== undefined && request.title.trim().length > 0
    ? request.title
    : automaticTitle(request, metadata.automaticTitleMaxChars)
  return freezeTask({
    id: metadata.id,
    sequence: metadata.sequence,
    identifier: `DSH-${metadata.sequence}`,
    revision: 0,
    title,
    titleMode: manualTitle ? 'manual' : 'automatic',
    description: request.description,
    acceptanceCriteria: request.acceptanceCriteria,
    status: 'initialized',
    position: metadata.position,
    ...(request.workspaceId === undefined ? {} : { workspaceId: request.workspaceId }),
    ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
    ...(request.agentPreset === undefined ? {} : { agentPreset: request.agentPreset }),
    attachments: request.attachments ?? [],
    rounds: [],
    activity: [{
      id: metadata.activityId,
      at: metadata.now,
      actor: 'user',
      operation: 'created',
    }],
    createdAt: metadata.now,
    updatedAt: metadata.now,
  })
}

/**
 * Apply a material content edit outside active execution.
 * @param task - Current authoritative task.
 * @param patch - Fields to replace or clear.
 * @param metadata - Activity identity and Host time.
 * @param automaticTitleMaxChars - Title limit used when resetting automatic mode.
 * @returns Original task for a no-op, otherwise a detached next revision.
 */
export function editTaskRecord(
  task: TaskBoardTask,
  patch: TaskBoardEditPatch,
  metadata: MutationMetadata,
  automaticTitleMaxChars: number,
): TaskBoardTask {
  if (task.status === 'running') throw stateError('invalid transition: cannot edit from running')
  if (patch.resetAutomaticTitle === true && patch.title !== undefined) {
    throw stateError('title and resetAutomaticTitle cannot be supplied together')
  }
  if (patch.workspaceId != null && patch.cwd != null) {
    throw stateError('task may select a Workspace or cwd, not both')
  }

  let next: TaskBoardTask = task
  const fields: TaskBoardEditableField[] = []
  const assign = <K extends keyof TaskBoardTask>(field: K, value: TaskBoardTask[K]): void => {
    if (next[field] === value) return
    next = { ...next, [field]: value }
    fields.push(field as TaskBoardEditableField)
  }

  if (patch.title !== undefined) {
    assign('title', patch.title)
    if (next.titleMode !== 'manual') next = { ...next, titleMode: 'manual' }
  }
  if (patch.resetAutomaticTitle === true) {
    const title = automaticTitle({
      title: '',
      description: patch.description ?? next.description,
      acceptanceCriteria: patch.acceptanceCriteria ?? next.acceptanceCriteria,
      start: false,
    }, automaticTitleMaxChars)
    assign('title', title)
    if (next.titleMode !== 'automatic') next = { ...next, titleMode: 'automatic' }
  }
  if (patch.description !== undefined) assign('description', patch.description)
  if (patch.acceptanceCriteria !== undefined) assign('acceptanceCriteria', patch.acceptanceCriteria)

  if (patch.workspaceId !== undefined) {
    const desiredWorkspace = patch.workspaceId ?? undefined
    if (next.workspaceId !== desiredWorkspace) {
      const { workspaceId: _workspaceId, ...withoutWorkspace } = next
      next = desiredWorkspace === undefined ? withoutWorkspace : {
        ...withoutWorkspace,
        workspaceId: desiredWorkspace,
      }
      fields.push('workspaceId')
    }
    if (desiredWorkspace !== undefined && next.cwd !== undefined) {
      const { cwd: _cwd, ...withoutCwd } = next
      next = withoutCwd
      fields.push('cwd')
    }
  }
  if (patch.cwd !== undefined) {
    const desiredCwd = patch.cwd ?? undefined
    if (next.cwd !== desiredCwd) {
      const { cwd: _cwd, ...withoutCwd } = next
      next = desiredCwd === undefined
        ? withoutCwd
        : { ...withoutCwd, cwd: desiredCwd }
      fields.push('cwd')
    }
    if (desiredCwd !== undefined && next.workspaceId !== undefined) {
      const { workspaceId: _workspaceId, ...withoutWorkspace } = next
      next = withoutWorkspace
      fields.push('workspaceId')
    }
  }
  if (patch.agentPreset !== undefined) {
    const desiredPreset = patch.agentPreset ?? undefined
    if (next.agentPreset !== desiredPreset) {
      const { agentPreset: _agentPreset, ...withoutPreset } = next
      next = desiredPreset === undefined
        ? withoutPreset
        : { ...withoutPreset, agentPreset: desiredPreset }
      fields.push('agentPreset')
    }
  }
  if (patch.attachments !== undefined && !sameAttachments(next.attachments, patch.attachments)) {
    next = { ...next, attachments: patch.attachments }
    fields.push('attachments')
  }

  const uniqueFields = [...new Set(fields)]
  if (uniqueFields.length === 0) return task
  return nextTask(task, metadata.now, {
    ...next,
    workspaceId: next.workspaceId,
    cwd: next.cwd,
    agentPreset: next.agentPreset,
    activity: [...task.activity, {
      id: metadata.activityId,
      at: metadata.now,
      actor: 'user',
      operation: 'edited',
      fields: uniqueFields,
    }],
  })
}

/**
 * Start one execution round through a legal workflow action.
 * @param task - Current authoritative task.
 * @param input - Round, Session, prompt, and activity allocation.
 * @returns Detached running task with one new active latest round.
 */
export function startRoundRecord(task: TaskBoardTask, input: TaskBoardStartRoundInput): TaskBoardTask {
  validateStart(task, input.trigger)
  const round = createRound(task, input)
  return nextTask(task, input.now, {
    status: 'running',
    currentSessionId: input.sessionId,
    rounds: [...task.rounds, round],
    activity: [...task.activity, {
      id: input.activityId,
      at: input.now,
      actor: 'user',
      operation: 'started',
      roundId: input.roundId,
      trigger: input.trigger,
    }, transitionActivity(input, task.status, 'running')],
    lastStartFailure: undefined,
    completedAt: undefined,
  })
}

/**
 * Append a board prompt to the current active round.
 * @param task - Running authoritative task.
 * @param prompt - Prompt requested through the ordinary Session API.
 * @param metadata - Activity identity and Host time.
 * @returns Detached next revision retaining the same round.
 */
export function appendPromptRecord(
  task: TaskBoardTask,
  prompt: TaskBoardRoundPrompt,
  metadata: MutationMetadata,
): TaskBoardTask {
  requireTransition(task, 'running', 'follow up')
  const round = activeRound(task)
  const activity = prompt.kind === 'followup'
    ? [{
      id: metadata.activityId,
      at: metadata.now,
      actor: 'user' as const,
      operation: 'followup' as const,
      roundId: round.id,
      promptId: prompt.id,
    }]
    : []
  return nextTask(task, metadata.now, {
    rounds: replaceLatestRound(task, { ...round, prompts: [...round.prompts, prompt] }),
    activity: [...task.activity, ...activity],
  })
}

/**
 * Mark a newly admitted round as running after ApiProxy accepts its prompt.
 * @param task - Running task whose latest round is still starting.
 * @param metadata - Host time for the durable admission update.
 * @returns Original task when already running, otherwise a detached next revision.
 */
export function markRoundRunningRecord(
  task: TaskBoardTask,
  metadata: { readonly now: number },
): TaskBoardTask {
  requireTransition(task, 'running', 'mark round running')
  const round = activeRound(task)
  if (round.status === 'running') return task
  return nextTask(task, metadata.now, {
    rounds: replaceLatestRound(task, { ...round, status: 'running' }),
  })
}

/**
 * Restore a round's origin workflow state when Session or prompt admission fails.
 * @param task - Running task with the failed starting latest round.
 * @param failure - Stable user-safe admission failure.
 * @param metadata - Activity identity and Host time.
 * @returns Detached origin-state task retaining the failed round for diagnosis.
 */
export function failRoundAdmissionRecord(
  task: TaskBoardTask,
  failure: TaskBoardFailure,
  metadata: MutationMetadata,
): TaskBoardTask {
  requireTransition(task, 'running', 'fail round admission')
  const round = activeRound(task)
  const previousSessionId = task.rounds.at(-2)?.sessionId
  return nextTask(task, metadata.now, {
    status: round.originStatus,
    currentSessionId: previousSessionId,
    rounds: replaceLatestRound(task, {
      ...round,
      status: 'failed',
      endedAt: metadata.now,
      failure,
    }),
    lastStartFailure: failure,
    activity: [...task.activity, {
      id: metadata.activityId,
      at: metadata.now,
      actor: 'system',
      operation: 'failed',
      roundId: round.id,
      failure,
    }, transitionActivity(metadata, 'running', round.originStatus)],
  })
}

/**
 * Attach Session sequence and turn evidence to prompts in the active round.
 * @param task - Running task whose latest round owns the prompts.
 * @param evidence - Matched durable Session evidence by prompt identity.
 * @param now - Host reconciliation time.
 * @returns Original task when unchanged, otherwise a detached next revision.
 */
export function recordRoundEvidence(
  task: TaskBoardTask,
  evidence: readonly TaskBoardPromptEvidence[],
  now: number,
): TaskBoardTask {
  requireTransition(task, 'running', 'record Session evidence')
  const round = activeRound(task)
  const byPrompt = new Map(evidence.map(item => [item.promptId, item]))
  const prompts = round.prompts.map((prompt) => {
    const matched = byPrompt.get(prompt.id)
    if (matched === undefined) return prompt
    if (prompt.messageSeq === matched.messageSeq
      && prompt.turn === matched.turn
      && prompt.turnEndSeq === matched.turnEndSeq) return prompt
    return {
      ...prompt,
      messageSeq: matched.messageSeq,
      turn: matched.turn,
      ...(matched.turnEndSeq === undefined ? {} : { turnEndSeq: matched.turnEndSeq }),
    }
  })
  if (prompts.every((prompt, index) => prompt === round.prompts[index])) return task
  const startSeq = Math.min(...evidence.map(item => item.turnStartSeq))
  const terminalSeqs = evidence.flatMap(item => item.turnEndSeq === undefined ? [] : [item.turnEndSeq])
  return nextTask(task, now, {
    rounds: replaceLatestRound(task, {
      ...round,
      prompts,
      startSeq,
      ...(terminalSeqs.length === 0 ? {} : { endSeq: Math.max(...terminalSeqs) }),
    }),
  })
}

/**
 * Remove a just-staged prompt after ApiProxy rejects it.
 * @param task - Running task containing the staged prompt.
 * @param promptId - Prompt that did not enter the Session.
 * @param now - Host rollback time.
 * @returns Detached next revision, or original task if prompt is absent.
 */
export function rollbackPromptRecord(
  task: TaskBoardTask,
  promptId: TaskBoardPromptId,
  now: number,
): TaskBoardTask {
  requireTransition(task, 'running', 'rollback prompt')
  const round = activeRound(task)
  if (!round.prompts.some(prompt => prompt.id === promptId)) return task
  return nextTask(task, now, {
    rounds: replaceLatestRound(task, {
      ...round,
      prompts: round.prompts.filter(prompt => prompt.id !== promptId),
    }),
    activity: task.activity.filter(activity =>
      activity.operation !== 'followup' || activity.promptId !== promptId),
  })
}

/**
 * Record a user stop request while Session cancellation settles.
 * @param task - Running task with an active latest round.
 * @param metadata - Activity identity and Host time.
 * @returns Detached running revision carrying stop intent.
 */
export function requestStopRecord(task: TaskBoardTask, metadata: MutationMetadata): TaskBoardTask {
  requireTransition(task, 'running', 'stop')
  const round = activeRound(task)
  return nextTask(task, metadata.now, {
    activity: [...task.activity, {
      id: metadata.activityId,
      at: metadata.now,
      actor: 'user',
      operation: 'stopped',
      roundId: round.id,
    }],
  })
}

/**
 * Start a revision round from human review using the current Session.
 * @param task - Task awaiting review.
 * @param input - Required feedback and deterministic identifiers.
 * @returns Detached running task with a revision round.
 */
export function rejectTaskRecord(task: TaskBoardTask, input: TaskBoardRejectRecordInput): TaskBoardTask {
  requireTransition(task, 'review', 'reject')
  if (input.feedback.trim().length === 0) throw stateError('rejection feedback is blank')
  if (task.currentSessionId === undefined) throw stateError('review task has no current Session')
  const withRejection = freezeTask({
    ...task,
    activity: [...task.activity, {
      id: input.activityId,
      at: input.now,
      actor: 'user',
      operation: 'rejected',
      roundId: input.roundId,
      feedback: input.feedback,
    }],
  })
  return startRoundRecord(withRejection, {
    roundId: input.roundId,
    sessionId: task.currentSessionId,
    trigger: 'revision',
    feedback: input.feedback,
    prompt: {
      id: input.promptId,
      rpcId: input.rpcId,
      kind: 'feedback',
      text: input.feedback,
      acceptedAt: input.now,
    },
    activityId: derivedActivityId(input.activityId, 'started'),
    now: input.now,
  })
}

/**
 * Start one explicit retry round after execution failure.
 * @param task - Failed task that remains unchanged until this call.
 * @param input - Chosen Session, prompt text, and deterministic identifiers.
 * @returns Detached running task with exactly one new retry round.
 */
export function retryTaskRecord(task: TaskBoardTask, input: TaskBoardRetryRecordInput): TaskBoardTask {
  requireTransition(task, 'failed', 'retry')
  const withRetry = freezeTask({
    ...task,
    activity: [...task.activity, {
      id: input.activityId,
      at: input.now,
      actor: 'user',
      operation: 'retried',
      roundId: input.roundId,
    }],
  })
  return startRoundRecord(withRetry, {
    roundId: input.roundId,
    sessionId: input.sessionId,
    trigger: 'retry',
    prompt: {
      id: input.promptId,
      rpcId: input.rpcId,
      kind: 'retry-continuation',
      text: input.text,
      acceptedAt: input.now,
    },
    activityId: derivedActivityId(input.activityId, 'started'),
    now: input.now,
  })
}

/**
 * Reduce ordered terminal Session evidence to one workflow outcome.
 * @param signals - Terminal evidence in Session sequence order.
 * @returns Running when no evidence exists, otherwise the last terminal projection.
 */
export function projectRoundOutcome(signals: readonly TaskBoardRoundOutcomeSignal[]): TaskBoardRoundProjection {
  let projection: TaskBoardRoundProjection = { kind: 'running' }
  for (const signal of signals) {
    switch (signal.kind) {
      case 'completed':
        projection = { kind: 'review', ...(signal.endSeq === undefined ? {} : { endSeq: signal.endSeq }) }
        break
      case 'error':
        projection = {
          kind: 'failed',
          failure: signal.failure,
          ...(signal.endSeq === undefined ? {} : { endSeq: signal.endSeq }),
        }
        break
      case 'cancelled':
        projection = {
          kind: 'cancelled',
          failure: signal.failure,
          ...(signal.endSeq === undefined ? {} : { endSeq: signal.endSeq }),
        }
        break
        /* v8 ignore next -- TaskBoardRoundOutcomeSignal is a closed same-process union. */
      default:
        assertNever(signal, 'round outcome signal')
    }
  }
  return projection
}

/**
 * Apply a Session-derived outcome to the active latest round.
 * @param task - Running task with one active latest round.
 * @param projection - Current projection of durable Session evidence.
 * @param metadata - Activity identity and Host reconciliation time.
 * @returns Original task while still running, otherwise a detached terminal revision.
 */
export function reconcileRound(
  task: TaskBoardTask,
  projection: TaskBoardRoundProjection,
  metadata: MutationMetadata,
): TaskBoardTask {
  requireTransition(task, 'running', 'reconcile')
  const round = activeRound(task)
  switch (projection.kind) {
    case 'running':
      return round.status === 'running'
        ? task
        : nextTask(task, metadata.now, {
          rounds: replaceLatestRound(task, { ...round, status: 'running' }),
        })
    case 'review': {
      const terminalRound: TaskBoardRound = {
        ...round,
        status: 'completed',
        endedAt: metadata.now,
        ...(projection.endSeq === undefined ? {} : { endSeq: projection.endSeq }),
      }
      return nextTask(task, metadata.now, {
        status: 'review',
        rounds: replaceLatestRound(task, terminalRound),
        activity: [...task.activity, transitionActivity(metadata, 'running', 'review')],
      })
    }
    case 'failed':
    case 'cancelled': {
      const terminalRound: TaskBoardRound = {
        ...round,
        status: projection.kind === 'failed' ? 'failed' : 'cancelled',
        endedAt: metadata.now,
        failure: projection.failure,
        ...(projection.endSeq === undefined ? {} : { endSeq: projection.endSeq }),
      }
      return nextTask(task, metadata.now, {
        status: 'failed',
        rounds: replaceLatestRound(task, terminalRound),
        activity: [...task.activity, {
          id: metadata.activityId,
          at: metadata.now,
          actor: 'system',
          operation: 'failed',
          roundId: round.id,
          failure: projection.failure,
        }, transitionActivity(metadata, 'running', 'failed')],
      })
    }
    /* v8 ignore next -- TaskBoardRoundProjection is a closed same-process union. */
    default:
      return assertNever(projection, 'round projection')
  }
}

/**
 * Record explicit human approval.
 * @param task - Task awaiting review.
 * @param metadata - Activity identity and Host time.
 * @returns Detached completed task.
 */
export function approveTaskRecord(task: TaskBoardTask, metadata: MutationMetadata): TaskBoardTask {
  requireTransition(task, 'review', 'approve')
  return nextTask(task, metadata.now, {
    status: 'done',
    completedAt: metadata.now,
    activity: [...task.activity, {
      id: metadata.activityId,
      at: metadata.now,
      actor: 'user',
      operation: 'approved',
    }, transitionActivity(metadata, 'review', 'done')],
  })
}

/**
 * Return an approved task to initialized state for new work.
 * @param task - Completed task.
 * @param metadata - Activity identity and Host time.
 * @returns Detached initialized task retaining prior rounds.
 */
export function reopenTaskRecord(task: TaskBoardTask, metadata: MutationMetadata): TaskBoardTask {
  requireTransition(task, 'done', 'reopen')
  const { completedAt: _completedAt, ...withoutCompletion } = task
  return nextTask(task, metadata.now, {
    ...withoutCompletion,
    status: 'initialized',
    completedAt: undefined,
    activity: [...task.activity, {
      id: metadata.activityId,
      at: metadata.now,
      actor: 'user',
      operation: 'reopened',
    }, transitionActivity(metadata, 'done', 'initialized')],
  })
}

/**
 * Reorder one task among same-status siblings without changing workflow state.
 * @param task - Current authoritative task.
 * @param siblings - Complete current column inventory.
 * @param request - Optional task before which the card should be placed.
 * @param metadata - Host mutation time.
 * @returns Ordered immutable records and records requiring persistence.
 */
export function reorderTaskRecord(
  task: TaskBoardTask,
  siblings: readonly TaskBoardTask[],
  request: TaskBoardReorderRequest,
  metadata: { readonly now: number },
): TaskBoardReorderResult {
  if (siblings.some(sibling => sibling.status !== task.status)) {
    throw stateError('reorder requires every sibling to have the same status')
  }
  const matching = siblings.filter(sibling => sibling.id === task.id)
  if (matching.length !== 1) throw stateError('reorder requires the task exactly once')
  if (request.beforeTaskId === task.id) {
    return { task, tasks: [...siblings].sort((left, right) => left.position.localeCompare(right.position)), changed: [] }
  }

  const ordered = [...siblings].sort((left, right) => left.position.localeCompare(right.position))
  const withoutTask = ordered.filter(sibling => sibling.id !== task.id)
  const insertAt = request.beforeTaskId === undefined
    ? withoutTask.length
    : withoutTask.findIndex(sibling => sibling.id === request.beforeTaskId)
  if (insertAt < 0) throw stateError('reorder anchor is not in the same status')
  const previous = withoutTask[insertAt - 1]
  const next = withoutTask[insertAt]
  const directPosition = positionBetween(previous?.position, next?.position)

  if (directPosition !== undefined) {
    if (directPosition === task.position) return { task, tasks: ordered, changed: [] }
    const moved = nextTask(task, metadata.now, { position: directPosition })
    const tasks = [...withoutTask]
    tasks.splice(insertAt, 0, moved)
    return { task: moved, tasks, changed: [moved] }
  }

  const rebalancedOrder = [...withoutTask]
  rebalancedOrder.splice(insertAt, 0, task)
  const changed: TaskBoardTask[] = []
  const tasks = rebalancedOrder.map((current, index) => {
    const position = formatPosition((index + 1) * POSITION_STEP)
    if (position === current.position) return current
    const replacement = nextTask(current, metadata.now, { position })
    changed.push(replacement)
    return replacement
  })
  const moved = tasks.find(current => current.id === task.id)
  /* v8 ignore next -- the task is inserted into rebalancedOrder immediately above. */
  if (moved === undefined) throw stateError('reordered task disappeared')
  return { task: moved, tasks, changed }
}

/**
 * Decide whether deletion is legal after any required confirmation.
 * @param task - Current authoritative task.
 * @param confirmed - Human confirmation for reviewed, completed, or failed work.
 * @returns `true` only when deletion may proceed.
 */
export function deleteAllowed(task: TaskBoardTask, confirmed: boolean): boolean {
  switch (task.status) {
    case 'initialized':
      return true
    case 'review':
    case 'done':
    case 'failed':
      return confirmed
    case 'running':
      return false
    /* v8 ignore next -- TaskBoardStatus is a closed same-process union. */
    default:
      return assertNever(task.status, 'task status')
  }
}

/**
 * Create a detached deeply frozen task projection.
 * @param task - Internal authoritative task record.
 * @returns Immutable snapshot sharing no mutable child with the source.
 */
export function snapshotTask(task: TaskBoardTask): TaskBoardTask {
  return freezeTask(task)
}

/**
 * Create an authoritative sorted board projection.
 * @param tasks - Internal task records in arbitrary order.
 * @param boardRevision - Committed global board revision.
 * @returns Deeply immutable snapshot sorted by status and position.
 */
export function snapshotBoard(tasks: readonly TaskBoardTask[], boardRevision: number): TaskBoardSnapshot {
  const sorted = tasks.map(snapshotTask).sort((left, right) => {
    const statusDifference = STATUS_RANK[left.status] - STATUS_RANK[right.status]
    if (statusDifference !== 0) return statusDifference
    const positionDifference = left.position.localeCompare(right.position)
    return positionDifference !== 0 ? positionDifference : left.sequence - right.sequence
  })
  return freezeSnapshot({ boardRevision, tasks: sorted })
}

/**
 * Build the ordinary initial Session prompt from task content.
 * @param task - Task whose requirement should enter model history.
 * @returns Prompt text with acceptance criteria only when supplied.
 */
export function composeInitialPrompt(task: TaskBoardTask): string {
  const description = task.description.trim()
  const criteria = task.acceptanceCriteria.trim()
  if (criteria.length === 0) return description
  if (description.length === 0) return `Acceptance criteria:\n${criteria}`
  return `${description}\n\nAcceptance criteria:\n${criteria}`
}
