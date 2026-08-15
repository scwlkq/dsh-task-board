/** Pure task-board workflow, ordering, prompt, and snapshot helpers. @module @deepseek-ai/dsh-task-board/src/state */
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type { TaskBoardSessionRequestId } from './session-types.ts';
import type { TaskBoardActivityId, TaskBoardCreateRequest, TaskBoardEditPatch, TaskBoardFailure, TaskBoardPromptId, TaskBoardReorderRequest, TaskBoardRoundId, TaskBoardRoundPrompt, TaskBoardRoundTrigger, TaskBoardSnapshot, TaskBoardTask, TaskBoardTaskId } from '../types.ts';
interface MutationMetadata {
    readonly activityId: TaskBoardActivityId;
    readonly now: number;
}
/** Deterministic allocation supplied by the Host for task creation. */
export interface TaskBoardCreateMetadata extends MutationMetadata {
    readonly id: TaskBoardTaskId;
    readonly sequence: number;
    readonly position: string;
    readonly automaticTitleMaxChars: number;
}
/** Deterministic allocation supplied when a round starts. */
export interface TaskBoardStartRoundInput extends MutationMetadata {
    readonly roundId: TaskBoardRoundId;
    readonly sessionId: SessionId;
    readonly trigger: TaskBoardRoundTrigger;
    readonly prompt: TaskBoardRoundPrompt;
    readonly feedback?: string;
}
/** Deterministic identifiers used when rejection starts a revision round. */
export interface TaskBoardRejectRecordInput extends MutationMetadata {
    readonly feedback: string;
    readonly roundId: TaskBoardRoundId;
    readonly promptId: TaskBoardPromptId;
    readonly rpcId: TaskBoardSessionRequestId;
}
/** Deterministic identifiers used when a user starts a retry round. */
export interface TaskBoardRetryRecordInput extends MutationMetadata {
    readonly sessionId: SessionId;
    readonly roundId: TaskBoardRoundId;
    readonly promptId: TaskBoardPromptId;
    readonly rpcId: TaskBoardSessionRequestId;
    readonly text: string;
}
/** Terminal evidence reduced from one round's Session events. */
export type TaskBoardRoundOutcomeSignal = {
    readonly kind: 'completed';
    readonly endSeq?: number;
} | {
    readonly kind: 'error';
    readonly failure: TaskBoardFailure;
    readonly endSeq?: number;
} | {
    readonly kind: 'cancelled';
    readonly failure: TaskBoardFailure;
    readonly endSeq?: number;
};
/** Current workflow projection of a round's durable Session evidence. */
export type TaskBoardRoundProjection = {
    readonly kind: 'running';
} | {
    readonly kind: 'review';
    readonly endSeq?: number;
} | {
    readonly kind: 'failed';
    readonly failure: TaskBoardFailure;
    readonly endSeq?: number;
} | {
    readonly kind: 'cancelled';
    readonly failure: TaskBoardFailure;
    readonly endSeq?: number;
};
/** Reorder result containing every record whose persisted position changed. */
export interface TaskBoardReorderResult {
    readonly task: TaskBoardTask;
    readonly tasks: readonly TaskBoardTask[];
    readonly changed: readonly TaskBoardTask[];
}
/** Durable Session evidence matched to one board prompt. */
export interface TaskBoardPromptEvidence {
    readonly promptId: TaskBoardPromptId;
    readonly messageSeq: number;
    readonly turn: number;
    readonly turnStartSeq: number;
    readonly turnEndSeq?: number;
}
/** Expected pure workflow rejection raised before a durable mutation. */
export declare class TaskBoardStateError extends Error {
    readonly name = "TaskBoardStateError";
}
/**
 * Create an initialized immutable record from already validated user input.
 * @param request - Initial task content and placement.
 * @param metadata - Host-owned identifiers, time, and title limit.
 * @returns Detached immutable task at revision zero.
 */
export declare function createTaskRecord(request: TaskBoardCreateRequest, metadata: TaskBoardCreateMetadata): TaskBoardTask;
/**
 * Apply a material content edit outside active execution.
 * @param task - Current authoritative task.
 * @param patch - Fields to replace or clear.
 * @param metadata - Activity identity and Host time.
 * @param automaticTitleMaxChars - Title limit used when resetting automatic mode.
 * @returns Original task for a no-op, otherwise a detached next revision.
 */
export declare function editTaskRecord(task: TaskBoardTask, patch: TaskBoardEditPatch, metadata: MutationMetadata, automaticTitleMaxChars: number): TaskBoardTask;
/**
 * Start one execution round through a legal workflow action.
 * @param task - Current authoritative task.
 * @param input - Round, Session, prompt, and activity allocation.
 * @returns Detached running task with one new active latest round.
 */
export declare function startRoundRecord(task: TaskBoardTask, input: TaskBoardStartRoundInput): TaskBoardTask;
/**
 * Append a board prompt to the current active round.
 * @param task - Running authoritative task.
 * @param prompt - Prompt requested through the ordinary Session API.
 * @param metadata - Activity identity and Host time.
 * @returns Detached next revision retaining the same round.
 */
export declare function appendPromptRecord(task: TaskBoardTask, prompt: TaskBoardRoundPrompt, metadata: MutationMetadata): TaskBoardTask;
/**
 * Mark a newly admitted round as running after ApiProxy accepts its prompt.
 * @param task - Running task whose latest round is still starting.
 * @param metadata - Host time for the durable admission update.
 * @returns Original task when already running, otherwise a detached next revision.
 */
export declare function markRoundRunningRecord(task: TaskBoardTask, metadata: {
    readonly now: number;
}): TaskBoardTask;
/**
 * Restore a round's origin workflow state when Session or prompt admission fails.
 * @param task - Running task with the failed starting latest round.
 * @param failure - Stable user-safe admission failure.
 * @param metadata - Activity identity and Host time.
 * @returns Detached origin-state task retaining the failed round for diagnosis.
 */
export declare function failRoundAdmissionRecord(task: TaskBoardTask, failure: TaskBoardFailure, metadata: MutationMetadata): TaskBoardTask;
/**
 * Attach Session sequence and turn evidence to prompts in the active round.
 * @param task - Running task whose latest round owns the prompts.
 * @param evidence - Matched durable Session evidence by prompt identity.
 * @param now - Host reconciliation time.
 * @returns Original task when unchanged, otherwise a detached next revision.
 */
export declare function recordRoundEvidence(task: TaskBoardTask, evidence: readonly TaskBoardPromptEvidence[], now: number): TaskBoardTask;
/**
 * Remove a just-staged prompt after ApiProxy rejects it.
 * @param task - Running task containing the staged prompt.
 * @param promptId - Prompt that did not enter the Session.
 * @param now - Host rollback time.
 * @returns Detached next revision, or original task if prompt is absent.
 */
export declare function rollbackPromptRecord(task: TaskBoardTask, promptId: TaskBoardPromptId, now: number): TaskBoardTask;
/**
 * Record a user stop request while Session cancellation settles.
 * @param task - Running task with an active latest round.
 * @param metadata - Activity identity and Host time.
 * @returns Detached running revision carrying stop intent.
 */
export declare function requestStopRecord(task: TaskBoardTask, metadata: MutationMetadata): TaskBoardTask;
/**
 * Start a revision round from human review using the current Session.
 * @param task - Task awaiting review.
 * @param input - Required feedback and deterministic identifiers.
 * @returns Detached running task with a revision round.
 */
export declare function rejectTaskRecord(task: TaskBoardTask, input: TaskBoardRejectRecordInput): TaskBoardTask;
/**
 * Start one explicit retry round after execution failure.
 * @param task - Failed task that remains unchanged until this call.
 * @param input - Chosen Session, prompt text, and deterministic identifiers.
 * @returns Detached running task with exactly one new retry round.
 */
export declare function retryTaskRecord(task: TaskBoardTask, input: TaskBoardRetryRecordInput): TaskBoardTask;
/**
 * Reduce ordered terminal Session evidence to one workflow outcome.
 * @param signals - Terminal evidence in Session sequence order.
 * @returns Running when no evidence exists, otherwise the last terminal projection.
 */
export declare function projectRoundOutcome(signals: readonly TaskBoardRoundOutcomeSignal[]): TaskBoardRoundProjection;
/**
 * Apply a Session-derived outcome to the active latest round.
 * @param task - Running task with one active latest round.
 * @param projection - Current projection of durable Session evidence.
 * @param metadata - Activity identity and Host reconciliation time.
 * @returns Original task while still running, otherwise a detached terminal revision.
 */
export declare function reconcileRound(task: TaskBoardTask, projection: TaskBoardRoundProjection, metadata: MutationMetadata): TaskBoardTask;
/**
 * Record explicit human approval.
 * @param task - Task awaiting review.
 * @param metadata - Activity identity and Host time.
 * @returns Detached completed task.
 */
export declare function approveTaskRecord(task: TaskBoardTask, metadata: MutationMetadata): TaskBoardTask;
/**
 * Return an approved task to initialized state for new work.
 * @param task - Completed task.
 * @param metadata - Activity identity and Host time.
 * @returns Detached initialized task retaining prior rounds.
 */
export declare function reopenTaskRecord(task: TaskBoardTask, metadata: MutationMetadata): TaskBoardTask;
/**
 * Reorder one task among same-status siblings without changing workflow state.
 * @param task - Current authoritative task.
 * @param siblings - Complete current column inventory.
 * @param request - Optional task before which the card should be placed.
 * @param metadata - Host mutation time.
 * @returns Ordered immutable records and records requiring persistence.
 */
export declare function reorderTaskRecord(task: TaskBoardTask, siblings: readonly TaskBoardTask[], request: TaskBoardReorderRequest, metadata: {
    readonly now: number;
}): TaskBoardReorderResult;
/**
 * Decide whether deletion is legal after any required confirmation.
 * @param task - Current authoritative task.
 * @param confirmed - Human confirmation for reviewed, completed, or failed work.
 * @returns `true` only when deletion may proceed.
 */
export declare function deleteAllowed(task: TaskBoardTask, confirmed: boolean): boolean;
/**
 * Create a detached deeply frozen task projection.
 * @param task - Internal authoritative task record.
 * @returns Immutable snapshot sharing no mutable child with the source.
 */
export declare function snapshotTask(task: TaskBoardTask): TaskBoardTask;
/**
 * Create an authoritative sorted board projection.
 * @param tasks - Internal task records in arbitrary order.
 * @param boardRevision - Committed global board revision.
 * @returns Deeply immutable snapshot sorted by status and position.
 */
export declare function snapshotBoard(tasks: readonly TaskBoardTask[], boardRevision: number): TaskBoardSnapshot;
/**
 * Build the ordinary initial Session prompt from task content.
 * @param task - Task whose requirement should enter model history.
 * @returns Prompt text with acceptance criteria only when supplied.
 */
export declare function composeInitialPrompt(task: TaskBoardTask): string;
export {};
