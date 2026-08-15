/** Client-safe task-board Session request and result vocabulary. @module @deepseek-ai/dsh-task-board-session/types */

import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '../workspace-id.ts'

/** Correlates one task-board request with the admitted Session operation. */
export type TaskBoardSessionRequestId = Branded<'TaskBoardSessionRequestId'>

/**
 * Brand a task-board Session request id.
 * @param id - Opaque request identity.
 * @returns The same string with its task-board Session request brand.
 */
export function TaskBoardSessionRequestId(id: string): TaskBoardSessionRequestId {
  return id as TaskBoardSessionRequestId
}

/** Text or encoded image submitted through an ordinary Session prompt. */
export type TaskBoardSessionContentPart =
  | { readonly type: 'text'; readonly text: string }
  | {
    readonly type: 'image'
    readonly mediaType: ImageMediaType
    readonly data: string
    readonly name?: string
  }

/** Stable provider-independent Session admission failure. */
export interface TaskBoardSessionFailure {
  /** Stable error code supplied by the provider. */
  readonly code: string
  /** Correction-oriented message safe for task-board persistence. */
  readonly message: string
}

/** Result returned by every task-board Session provider operation. */
export type TaskBoardSessionResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: TaskBoardSessionFailure }

/** Request to create one named Harness Session. */
export interface TaskBoardSessionCreateRequest {
  /** Correlation identity forwarded to the Session API. */
  readonly requestId: TaskBoardSessionRequestId
  /** Session identity reserved by the task-board round. */
  readonly sessionId: SessionId
  /** Existing Workspace selected for the task. */
  readonly workspaceId?: WorkspaceId
  /** Absolute working directory used without a Workspace. */
  readonly cwd?: string
  /** Optional Agent Preset selected for the Session. */
  readonly agentPreset?: string
}

/** Request to enqueue one task-board prompt in an existing Session. */
export interface TaskBoardSessionPromptRequest {
  /** Correlation identity forwarded to the Session API. */
  readonly requestId: TaskBoardSessionRequestId
  /** Session receiving the prompt. */
  readonly sessionId: SessionId
  /** Ordered prompt parts submitted with queue semantics. */
  readonly content: readonly TaskBoardSessionContentPart[]
}

/** Request to stop the current Session turn. */
export interface TaskBoardSessionCancelRequest {
  /** Correlation identity forwarded to the Session API. */
  readonly requestId: TaskBoardSessionRequestId
  /** Session whose current turn should stop. */
  readonly sessionId: SessionId
}
