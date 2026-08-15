/**
 * Browser object layer for the authoritative task-board snapshot.
 * @module @deepseek-ai/dsh-client-ui-task-board/client/controller
 */
import type { RemoteFailure, RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots';
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment';
import type { TaskBoardAttachmentResult, TaskBoardAttachmentUploadRequest, TaskBoardChange, TaskBoardCreateRequest, TaskBoardDeleteResult, TaskBoardDeleteValue, TaskBoardEditPatch, TaskBoardFailureResult, TaskBoardFollowupRequest, TaskBoardRejectRequest, TaskBoardReorderRequest, TaskBoardRetryRequest, TaskBoardSnapshotResult, TaskBoardTask, TaskBoardTaskId, TaskBoardTaskRef, TaskBoardTaskResult } from '../types.ts';
/** Generated task-board Remote methods consumed by the Client controller. */
export interface TaskBoardRemote {
    snapshot: () => Promise<RemoteResult<TaskBoardSnapshotResult>>;
    uploadAttachment: (request: TaskBoardAttachmentUploadRequest) => Promise<RemoteResult<TaskBoardAttachmentResult>>;
    create: (request: TaskBoardCreateRequest) => Promise<RemoteResult<TaskBoardTaskResult>>;
    edit: (ref: TaskBoardTaskRef, patch: TaskBoardEditPatch) => Promise<RemoteResult<TaskBoardTaskResult>>;
    reorder: (ref: TaskBoardTaskRef, request: TaskBoardReorderRequest) => Promise<RemoteResult<TaskBoardTaskResult>>;
    start: (ref: TaskBoardTaskRef) => Promise<RemoteResult<TaskBoardTaskResult>>;
    followup: (ref: TaskBoardTaskRef, request: TaskBoardFollowupRequest) => Promise<RemoteResult<TaskBoardTaskResult>>;
    approve: (ref: TaskBoardTaskRef) => Promise<RemoteResult<TaskBoardTaskResult>>;
    reject: (ref: TaskBoardTaskRef, request: TaskBoardRejectRequest) => Promise<RemoteResult<TaskBoardTaskResult>>;
    retry: (ref: TaskBoardTaskRef, request: TaskBoardRetryRequest) => Promise<RemoteResult<TaskBoardTaskResult>>;
    stop: (ref: TaskBoardTaskRef) => Promise<RemoteResult<TaskBoardTaskResult>>;
    reopen: (ref: TaskBoardTaskRef) => Promise<RemoteResult<TaskBoardTaskResult>>;
    delete: (ref: TaskBoardTaskRef) => Promise<RemoteResult<TaskBoardDeleteResult>>;
}
/** Loading phase for the shared authoritative board projection. */
export type TaskBoardClientStatus = 'cold' | 'loading' | 'ready' | 'error';
/** Immutable view published to both task-board slot entries. */
export interface TaskBoardClientView {
    readonly status: TaskBoardClientStatus;
    readonly boardRevision: number;
    readonly tasks: readonly TaskBoardTask[];
    readonly pendingTaskIds: readonly TaskBoardTaskId[];
    readonly creating: boolean;
    readonly error: RemoteFailure | TaskBoardFailureResult | null;
}
/** One normalized Client operation result across carrier and business failures. */
export type TaskBoardClientResult<T> = {
    readonly ok: true;
    readonly value: T;
} | {
    readonly ok: false;
    readonly error: RemoteFailure | TaskBoardFailureResult;
};
/**
 * Resolve a correction-oriented message from an open carrier/business failure.
 * @param error - normalized task-board failure.
 * @returns Host message when present, otherwise stable failure code.
 */
export declare function taskBoardErrorMessage(error: RemoteFailure | TaskBoardFailureResult): string;
/**
 * Owns task-board Remote synchronization and mutation serialization state.
 * Components consume it through the slot framework's injected observable hook.
 */
export declare class TaskBoardController implements HostObservable<TaskBoardClientView> {
    private readonly remote;
    private view;
    private readonly listeners;
    private readonly pendingTaskCounts;
    private refreshPromise;
    private disposed;
    /**
     * @param remote - generated `taskBoard` Remote namespace.
     */
    constructor(remote: TaskBoardRemote);
    /** @returns current immutable board projection. */
    getSnapshot: () => TaskBoardClientView;
    /**
     * Subscribe to projection replacement.
     * @param listener - callback invoked after each committed Client view change.
     * @returns subscription disposer.
     */
    subscribe: (listener: () => void) => (() => void);
    /**
     * Read a full authoritative snapshot, coalescing concurrent callers.
     * @returns normalized load result.
     */
    refresh(): Promise<TaskBoardClientResult<readonly TaskBoardTask[]>>;
    /**
     * Reconcile one forwarded committed Host change.
     * @param change - revisioned task-board event.
     * @returns completion after any required snapshot refresh.
     */
    acceptChange(change: TaskBoardChange): Promise<void>;
    /**
     * Re-read authority after a new transport generation is established.
     * @returns normalized refresh result.
     */
    connectionReset(): Promise<TaskBoardClientResult<readonly TaskBoardTask[]>>;
    /**
     * Create a durable card and optionally start its first execution round.
     * @param request - card fields and start intent.
     * @returns committed card or normalized failure.
     */
    create(request: TaskBoardCreateRequest): Promise<TaskBoardClientResult<TaskBoardTask>>;
    /**
     * Persist one browser-staged task image without changing the board projection.
     * @param request - Canonical image upload payload.
     * @returns Durable attachment reference or normalized failure.
     */
    uploadAttachment(request: TaskBoardAttachmentUploadRequest): Promise<TaskBoardClientResult<ImageAttachmentRef>>;
    /**
     * Edit material task fields using the latest observed revision.
     * @param taskId - card identity.
     * @param patch - replacement fields.
     * @returns committed card or normalized failure.
     */
    edit(taskId: TaskBoardTaskId, patch: TaskBoardEditPatch): Promise<TaskBoardClientResult<TaskBoardTask>>;
    /**
     * Start one initialized card.
     * @param taskId - card identity.
     * @returns committed running card or normalized failure.
     */
    start(taskId: TaskBoardTaskId): Promise<TaskBoardClientResult<TaskBoardTask>>;
    /**
     * Add another instruction to the active execution round.
     * @param taskId - card identity.
     * @param text - non-blank follow-up text.
     * @returns committed card or normalized failure.
     */
    followup(taskId: TaskBoardTaskId, text: string): Promise<TaskBoardClientResult<TaskBoardTask>>;
    /**
     * Approve reviewed output.
     * @param taskId - card identity.
     * @returns committed completed card or normalized failure.
     */
    approve(taskId: TaskBoardTaskId): Promise<TaskBoardClientResult<TaskBoardTask>>;
    /**
     * Reject reviewed output and start a feedback revision round.
     * @param taskId - card identity.
     * @param feedback - required review feedback.
     * @returns committed running card or normalized failure.
     */
    reject(taskId: TaskBoardTaskId, feedback: string): Promise<TaskBoardClientResult<TaskBoardTask>>;
    /**
     * Retry a failed card under the Host continuity policy.
     * @param taskId - card identity.
     * @param allowFreshSession - explicit permission to replace an unavailable Session.
     * @returns committed running card or normalized failure.
     */
    retry(taskId: TaskBoardTaskId, allowFreshSession: boolean): Promise<TaskBoardClientResult<TaskBoardTask>>;
    /**
     * Stop the active task round.
     * @param taskId - card identity.
     * @returns reconciled card or normalized failure.
     */
    stop(taskId: TaskBoardTaskId): Promise<TaskBoardClientResult<TaskBoardTask>>;
    /**
     * Reopen an approved card as initialized work.
     * @param taskId - card identity.
     * @returns committed initialized card or normalized failure.
     */
    reopen(taskId: TaskBoardTaskId): Promise<TaskBoardClientResult<TaskBoardTask>>;
    /**
     * Delete one non-running card.
     * @param taskId - card identity.
     * @returns deletion receipt or normalized failure.
     */
    delete(taskId: TaskBoardTaskId): Promise<TaskBoardClientResult<TaskBoardDeleteValue>>;
    /**
     * Optimistically move a card before another card in the same state.
     * @param taskId - moved card identity.
     * @param beforeTaskId - same-state anchor, or undefined to append.
     * @returns committed card or normalized failure.
     */
    reorder(taskId: TaskBoardTaskId, beforeTaskId?: TaskBoardTaskId): Promise<TaskBoardClientResult<TaskBoardTask>>;
    /** Release subscribers and prevent later Remote completions from publishing. */
    dispose(): void;
    private readSnapshot;
    private mutateTask;
    private reconcileConflict;
    private optimisticOrder;
    private replaceTask;
    private upsert;
    private setPending;
    private patch;
    private commit;
}
