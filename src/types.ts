/** Public task-board records and Remote request vocabulary. @module @deepseek-ai/dsh-task-board/types */

import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TaskBoardSessionRequestId } from '@deepseek-ai/dsh-task-board-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'

/** Stable identity of one continuing task card. */
export type TaskBoardTaskId = Branded<'TaskBoardTaskId'>

/** Stable identity of one execution round within a task. */
export type TaskBoardRoundId = Branded<'TaskBoardRoundId'>

/** Stable identity of one board-originated prompt. */
export type TaskBoardPromptId = Branded<'TaskBoardPromptId'>

/** Stable identity of one task activity entry. */
export type TaskBoardActivityId = Branded<'TaskBoardActivityId'>

/** Human workflow state owned by the task board. */
export type TaskBoardStatus = 'initialized' | 'running' | 'review' | 'done' | 'failed'

/** Whether a title may still follow the Session title capability. */
export type TaskBoardTitleMode = 'automatic' | 'manual'

/** Cause that created an execution round. */
export type TaskBoardRoundTrigger = 'initial' | 'revision' | 'retry'

/** Durable execution state of one round. */
export type TaskBoardRoundStatus = 'starting' | 'running' | 'completed' | 'failed' | 'cancelled'

/** Task state restored when round admission fails before execution. */
export type TaskBoardRoundOriginStatus = 'initialized' | 'review' | 'failed'

/** Role of a board-originated prompt inside its round. */
export type TaskBoardPromptKind = 'initial' | 'feedback' | 'followup' | 'retry-continuation'

/** Stable user-safe failure summary retained on a round or task. */
export interface TaskBoardFailure {
  /** Lifecycle phase that produced the failure. */
  readonly stage: 'session-create' | 'prompt-admission' | 'execution' | 'recovery'
  /** Stable provider-independent failure code. */
  readonly code: string
  /** Redacted correction-oriented summary suitable for the Client. */
  readonly message: string
  /** Session turn associated with the failure when known. */
  readonly turn?: number
  /** Session event sequence associated with the failure when known. */
  readonly seq?: number
}

/** One prompt admitted through the ordinary Harness Session API. */
export interface TaskBoardRoundPrompt {
  /** Board-local prompt identity. */
  readonly id: TaskBoardPromptId
  /** RPC identity used to match durable Session acceptance. */
  readonly rpcId: TaskBoardSessionRequestId
  /** Prompt role within the round. */
  readonly kind: TaskBoardPromptKind
  /** Exact user-facing text submitted to the Session. */
  readonly text: string
  /** Host time when prompt admission was requested. */
  readonly acceptedAt: number
  /** Durable `user/message` sequence after acceptance. */
  readonly messageSeq?: number
  /** Session turn assigned to the accepted prompt. */
  readonly turn?: number
  /** Matching terminal `turn/end` sequence. */
  readonly turnEndSeq?: number
}

/** One attempt to advance a task through a Harness Session. */
export interface TaskBoardRound {
  /** Stable round identity. */
  readonly id: TaskBoardRoundId
  /** One-based contiguous position inside the task. */
  readonly ordinal: number
  /** User action that created the round. */
  readonly trigger: TaskBoardRoundTrigger
  /** Current durable execution state. */
  readonly status: TaskBoardRoundStatus
  /** Workflow state restored if admission fails. */
  readonly originStatus: TaskBoardRoundOriginStatus
  /** Harness Session carrying the round. */
  readonly sessionId: SessionId
  /** Board-originated prompts admitted during this round. */
  readonly prompts: readonly TaskBoardRoundPrompt[]
  /** First Session event sequence belonging to the round. */
  readonly startSeq?: number
  /** Last terminal Session event sequence belonging to the round. */
  readonly endSeq?: number
  /** Host time when round admission began. */
  readonly startedAt: number
  /** Host time when the round reached a terminal state. */
  readonly endedAt?: number
  /** Required human rejection feedback for revision rounds. */
  readonly feedback?: string
  /** Stable terminal failure summary for failed or cancelled rounds. */
  readonly failure?: TaskBoardFailure
}

/** User, Agent, or Host subsystem that caused an activity entry. */
export type TaskBoardActivityActor = 'user' | 'agent' | 'system'

/** Task fields whose material values may be edited. */
export type TaskBoardEditableField =
  | 'title'
  | 'description'
  | 'acceptanceCriteria'
  | 'workspaceId'
  | 'cwd'
  | 'agentPreset'
  | 'attachments'

interface TaskBoardActivityBase {
  /** Stable activity identity. */
  readonly id: TaskBoardActivityId
  /** Host-assigned Unix epoch time in milliseconds. */
  readonly at: number
  /** Origin of this activity. */
  readonly actor: TaskBoardActivityActor
}

/** Card creation activity. */
export interface TaskBoardCreatedActivity extends TaskBoardActivityBase {
  readonly operation: 'created'
}

/** Material task-content edit activity. */
export interface TaskBoardEditedActivity extends TaskBoardActivityBase {
  readonly operation: 'edited'
  readonly fields: readonly TaskBoardEditableField[]
}

/** Execution-round admission activity. */
export interface TaskBoardStartedActivity extends TaskBoardActivityBase {
  readonly operation: 'started'
  readonly roundId: TaskBoardRoundId
  readonly trigger: TaskBoardRoundTrigger
}

/** Prompt appended while a round is active. */
export interface TaskBoardFollowupActivity extends TaskBoardActivityBase {
  readonly operation: 'followup'
  readonly roundId: TaskBoardRoundId
  readonly promptId: TaskBoardPromptId
}

/** Host-owned workflow state transition activity. */
export interface TaskBoardTransitionActivity extends TaskBoardActivityBase {
  readonly operation: 'transition'
  readonly from: TaskBoardStatus
  readonly to: TaskBoardStatus
}

/** Human approval activity. */
export interface TaskBoardApprovedActivity extends TaskBoardActivityBase {
  readonly operation: 'approved'
}

/** Human rejection and feedback activity. */
export interface TaskBoardRejectedActivity extends TaskBoardActivityBase {
  readonly operation: 'rejected'
  readonly roundId: TaskBoardRoundId
  readonly feedback: string
}

/** Terminal round failure activity. */
export interface TaskBoardFailedActivity extends TaskBoardActivityBase {
  readonly operation: 'failed'
  readonly roundId: TaskBoardRoundId
  readonly failure: TaskBoardFailure
}

/** Manual retry activity. */
export interface TaskBoardRetriedActivity extends TaskBoardActivityBase {
  readonly operation: 'retried'
  readonly roundId: TaskBoardRoundId
}

/** Reopening an approved card activity. */
export interface TaskBoardReopenedActivity extends TaskBoardActivityBase {
  readonly operation: 'reopened'
}

/** Automatic title synchronization activity. */
export interface TaskBoardAutomaticTitleActivity extends TaskBoardActivityBase {
  readonly operation: 'automatic-title'
  readonly title: string
}

/** User-requested execution stop activity. */
export interface TaskBoardStoppedActivity extends TaskBoardActivityBase {
  readonly operation: 'stopped'
  readonly roundId: TaskBoardRoundId
}

/** Append-only user-facing task history entry. */
export type TaskBoardActivity =
  | TaskBoardCreatedActivity
  | TaskBoardEditedActivity
  | TaskBoardStartedActivity
  | TaskBoardFollowupActivity
  | TaskBoardTransitionActivity
  | TaskBoardApprovedActivity
  | TaskBoardRejectedActivity
  | TaskBoardFailedActivity
  | TaskBoardRetriedActivity
  | TaskBoardReopenedActivity
  | TaskBoardAutomaticTitleActivity
  | TaskBoardStoppedActivity

/** Durable task card with its ordered execution and review history. */
export interface TaskBoardTask {
  /** Stable opaque card identity. */
  readonly id: TaskBoardTaskId
  /** Monotonic numeric identifier allocation. */
  readonly sequence: number
  /** Human-readable identifier derived from sequence. */
  readonly identifier: string
  /** Compare-and-set revision incremented by every material task mutation. */
  readonly revision: number
  /** Current display title. */
  readonly title: string
  /** Whether Session title changes may replace the display title. */
  readonly titleMode: TaskBoardTitleMode
  /** Primary task requirement. */
  readonly description: string
  /** Human-verifiable completion conditions. */
  readonly acceptanceCriteria: string
  /** Current human workflow state. */
  readonly status: TaskBoardStatus
  /** Stable sortable value interpreted only within the current status. */
  readonly position: string
  /** Existing Harness Workspace used for Session creation. */
  readonly workspaceId?: WorkspaceId
  /** Absolute working directory used when no Workspace is selected. */
  readonly cwd?: string
  /** Optional Session Agent Preset name. */
  readonly agentPreset?: string
  /** Durable image references submitted with the initial prompt. */
  readonly attachments: readonly ImageAttachmentRef[]
  /** Current or most recently used Harness Session. */
  readonly currentSessionId?: SessionId
  /** Ordered one-based execution rounds. */
  readonly rounds: readonly TaskBoardRound[]
  /** Append-only task workflow history. */
  readonly activity: readonly TaskBoardActivity[]
  /** Admission failure not represented as an execution failure round. */
  readonly lastStartFailure?: TaskBoardFailure
  /** Host creation time in Unix epoch milliseconds. */
  readonly createdAt: number
  /** Host time of the most recent material mutation. */
  readonly updatedAt: number
  /** Human approval time while status is `done`. */
  readonly completedAt?: number
}

/** Compare-and-set reference required by every task mutation. */
export interface TaskBoardTaskRef {
  readonly id: TaskBoardTaskId
  readonly revision: number
}

/** Initial task content and optional immediate execution request. */
export interface TaskBoardCreateRequest {
  readonly title?: string
  readonly description: string
  readonly acceptanceCriteria: string
  readonly workspaceId?: WorkspaceId
  readonly cwd?: string
  readonly agentPreset?: string
  readonly attachments?: readonly ImageAttachmentRef[]
  readonly start: boolean
}

/** Browser image bytes staged before a task card is committed. */
export interface TaskBoardAttachmentUploadRequest {
  readonly mediaType: ImageMediaType
  readonly data: string
  readonly name?: string
}

/** Material task fields accepted before or between execution rounds. */
export interface TaskBoardEditPatch {
  readonly title?: string
  readonly resetAutomaticTitle?: boolean
  readonly description?: string
  readonly acceptanceCriteria?: string
  readonly workspaceId?: WorkspaceId | null
  readonly cwd?: string | null
  readonly agentPreset?: string | null
  readonly attachments?: readonly ImageAttachmentRef[]
}

/** Same-column placement request; omitted anchor appends to the column. */
export interface TaskBoardReorderRequest {
  readonly beforeTaskId?: TaskBoardTaskId
}

/** Additional instruction submitted while a round is active. */
export interface TaskBoardFollowupRequest {
  readonly text: string
}

/** Required feedback that starts a revision round. */
export interface TaskBoardRejectRequest {
  readonly feedback: string
}

/** Manual retry policy when the previous Session cannot be resumed. */
export interface TaskBoardRetryRequest {
  readonly allowFreshSession: boolean
}

/** Authoritative immutable board projection. */
export interface TaskBoardSnapshot {
  readonly boardRevision: number
  readonly tasks: readonly TaskBoardTask[]
}

/** Committed mutation event forwarded to connected Clients. */
export interface TaskBoardChange {
  readonly boardRevision: number
  readonly operation: 'created' | 'updated' | 'deleted'
  readonly taskId: TaskBoardTaskId
  readonly task?: TaskBoardTask
}

/** Requested card does not exist. */
export interface TaskBoardTaskNotFound {
  readonly code: 'task-not-found'
  readonly taskId: TaskBoardTaskId
}

/** Mutation observed an obsolete task revision. */
export interface TaskBoardRevisionConflict {
  readonly code: 'revision-conflict'
  readonly current: TaskBoardTask
}

/** Requested operation is not legal from the current workflow state. */
export interface TaskBoardInvalidTransition {
  readonly code: 'invalid-transition'
  readonly status: TaskBoardStatus
  readonly operation: string
}

/** A task already has an active latest execution round. */
export interface TaskBoardRoundAlreadyActive {
  readonly code: 'round-already-active'
  readonly roundId: TaskBoardRoundId
}

/** A Harness Session is already linked to another task. */
export interface TaskBoardSessionOwnedByAnotherTask {
  readonly code: 'session-owned-by-another-task'
  readonly sessionId: SessionId
  readonly taskId: TaskBoardTaskId
}

/** Persisted Session cannot currently accept another prompt. */
export interface TaskBoardSessionUnavailable {
  readonly code: 'session-unavailable'
  readonly sessionId: SessionId
}

/** Continuity requires explicit permission to start a replacement Session. */
export interface TaskBoardFreshSessionRequired {
  readonly code: 'fresh-session-required'
  readonly sessionId: SessionId
}

/** Ordinary Session prompt admission rejected the board prompt. */
export interface TaskBoardPromptRejected {
  readonly code: 'prompt-rejected'
  readonly failure: TaskBoardFailure
}

/** Request fields fail task-board validation. */
export interface TaskBoardInvalidRequest {
  readonly code: 'invalid-request'
  readonly field: string
  readonly message: string
}

/** Image admission or durable attachment storage failed. */
export interface TaskBoardAttachmentFailure {
  readonly code: 'attachment-error'
  readonly reason: string
  readonly message: string
}

/** Stable business failures returned without rejecting the Remote call. */
export type TaskBoardFailureResult =
  | TaskBoardTaskNotFound
  | TaskBoardRevisionConflict
  | TaskBoardInvalidTransition
  | TaskBoardRoundAlreadyActive
  | TaskBoardSessionOwnedByAnotherTask
  | TaskBoardSessionUnavailable
  | TaskBoardFreshSessionRequired
  | TaskBoardPromptRejected
  | TaskBoardInvalidRequest
  | TaskBoardAttachmentFailure

/** Successful task-board operation. */
export interface TaskBoardSuccess<T> {
  readonly ok: true
  readonly value: T
}

/** Rejected task-board business operation. */
export interface TaskBoardRejected {
  readonly ok: false
  readonly error: TaskBoardFailureResult
}

/** Public operation result with stable business rejections. */
export type TaskBoardResult<T> = TaskBoardSuccess<T> | TaskBoardRejected

/** Result returned by task-card mutations. */
export type TaskBoardTaskResult = TaskBoardResult<TaskBoardTask>

/** Result returned after one task image is durably stored. */
export type TaskBoardAttachmentResult = TaskBoardResult<ImageAttachmentRef>

/** Result returned by authoritative board reads. */
export type TaskBoardSnapshotResult = TaskBoardResult<TaskBoardSnapshot>

/** Successful deletion acknowledgement. */
export interface TaskBoardDeleteValue {
  readonly deleted: true
  readonly taskId: TaskBoardTaskId
}

/** Result returned by card deletion. */
export type TaskBoardDeleteResult = TaskBoardResult<TaskBoardDeleteValue>

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Publishes one fully committed task-board mutation.
     * @param change - Authoritative task projection or deletion tombstone.
     * @mode emit
     */
    'task-board/changed'(change: TaskBoardChange): void
  }
}
