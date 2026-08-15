/** Durable reviewed task cards and Harness Session orchestration service. @module @deepseek-ai/dsh-task-board */
import { Context, Service } from '@deepseek-ai/cordis';
import s from '@deepseek-ai/schemastery';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import type { TaskBoardAttachmentResult, TaskBoardAttachmentUploadRequest, TaskBoardCreateRequest, TaskBoardDeleteResult, TaskBoardEditPatch, TaskBoardFollowupRequest, TaskBoardRejectRequest, TaskBoardReorderRequest, TaskBoardRetryRequest, TaskBoardSnapshotResult, TaskBoardTask, TaskBoardTaskId, TaskBoardTaskRef, TaskBoardTaskResult } from '../types.ts';
export type * from '../types.ts';
export { taskBoardActivitySchema, taskBoardDomainSpec, taskBoardFailureSchema, taskBoardGlobalSchema, taskBoardRoundPromptSchema, taskBoardRoundSchema, taskBoardTaskSchema, } from './spec.ts';
export type { TaskBoardGlobal } from './spec.ts';
/** Required deployment-varying task text and automatic-title limits. */
export interface Config {
    /** Maximum Unicode code points retained in an automatic title. */
    readonly automaticTitleMaxChars: number;
    /** Maximum UTF-8 byte length accepted for a manual title. */
    readonly maxTitleBytes: number;
    /** Maximum UTF-8 byte length accepted for a task description. */
    readonly maxDescriptionBytes: number;
    /** Maximum UTF-8 byte length accepted for acceptance criteria. */
    readonly maxAcceptanceCriteriaBytes: number;
    /** Maximum UTF-8 byte length accepted for rejection feedback. */
    readonly maxFeedbackBytes: number;
    /** Maximum UTF-8 byte length accepted for a running follow-up. */
    readonly maxFollowupBytes: number;
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        taskBoard: TaskBoardService;
    }
}
/** Host authority for durable task cards and public `taskBoard` Remote methods. */
export declare class TaskBoardService extends TypertRemoteService {
    static inject: string[];
    /** Loader validation for every deployment-varying text limit. */
    static Config: s<Config>;
    private readonly config;
    private global?;
    private tasks?;
    private boardTail;
    private readonly taskTails;
    private readonly activeSessions;
    private mutationAdmissionOpen;
    /**
     * @param ctx - Host context carrying the Storage Domain facility.
     * @param config - Required text and automatic-title limits.
     */
    constructor(ctx: Context, config: Config);
    /** Open and own the task-board Storage Domain. */
    protected [Service.init](): Promise<void>;
    /**
     * Read the authoritative board after all previously admitted commits.
     * @returns Immutable board snapshot and committed global revision.
     */
    snapshot(): Promise<TaskBoardSnapshotResult>;
    /**
     * Validate and persist one browser-staged task image.
     * @param request - Canonical base64 bytes, declared media type, and optional display name.
     * @returns Durable image reference or a correction-oriented request failure.
     */
    uploadAttachment(request: TaskBoardAttachmentUploadRequest): Promise<TaskBoardAttachmentResult>;
    /**
     * Create one durable initialized card and optionally start it.
     * @param request - Validated task content, placement, and start intent.
     * @returns Committed card or a stable request failure.
     */
    create(request: TaskBoardCreateRequest): Promise<TaskBoardTaskResult>;
    /**
     * Replace material card fields after a compare-and-set revision check.
     * @param ref - Task identity and observed revision.
     * @param patch - Fields to replace, clear, or reset to automatic title.
     * @returns Committed card, current conflict value, or stable request failure.
     */
    edit(ref: TaskBoardTaskRef, patch: TaskBoardEditPatch): Promise<TaskBoardTaskResult>;
    /**
     * Move a card before another card in the same workflow state.
     * @param ref - Task identity and observed revision.
     * @param request - Optional same-column anchor; omission appends.
     * @returns Committed moved task or stable rejection.
     */
    reorder(ref: TaskBoardTaskRef, request: TaskBoardReorderRequest): Promise<TaskBoardTaskResult>;
    /**
     * Start an initialized card in a newly created Harness Session.
     * @param ref - Task identity and observed revision.
     * @returns Running task after prompt admission, or a stable rejection.
     */
    start(ref: TaskBoardTaskRef): Promise<TaskBoardTaskResult>;
    /**
     * Append a non-blank instruction to the current active round.
     * @param ref - Task identity and observed revision.
     * @param request - Follow-up text admitted through the ordinary Session API.
     * @returns Updated running task or prompt rejection.
     */
    followup(ref: TaskBoardTaskRef, request: TaskBoardFollowupRequest): Promise<TaskBoardTaskResult>;
    /**
     * Reject reviewed output with required feedback and continue the same Session.
     * @param ref - Reviewed task identity and observed revision.
     * @param request - Required human feedback sent to the Agent.
     * @returns Running revision round or stable rejection.
     */
    reject(ref: TaskBoardTaskRef, request: TaskBoardRejectRequest): Promise<TaskBoardTaskResult>;
    /**
     * Start exactly one user-requested retry round.
     * @param ref - Failed task identity and observed revision.
     * @param request - Permission to replace an unavailable Session.
     * @returns Running retry, `fresh-session-required`, or stable rejection.
     */
    retry(ref: TaskBoardTaskRef, request: TaskBoardRetryRequest): Promise<TaskBoardTaskResult>;
    /**
     * Cancel an active Session turn and wait for its durable terminal evidence.
     * @param ref - Running task identity and observed revision.
     * @returns Reconciled failed card or stable cancellation rejection.
     */
    stop(ref: TaskBoardTaskRef): Promise<TaskBoardTaskResult>;
    /**
     * Mark a successfully executed reviewed task complete.
     * @param ref - Task identity and observed revision.
     * @returns Committed completed card or stable transition failure.
     */
    approve(ref: TaskBoardTaskRef): Promise<TaskBoardTaskResult>;
    /**
     * Reopen an approved card as initialized work while retaining its history.
     * @param ref - Task identity and observed revision.
     * @returns Committed initialized card or stable transition failure.
     */
    reopen(ref: TaskBoardTaskRef): Promise<TaskBoardTaskResult>;
    /**
     * Delete a non-running card without deleting linked Sessions or attachments.
     * @param ref - Task identity and observed revision after any Client confirmation.
     * @returns Durable deletion acknowledgement or stable rejection.
     */
    delete(ref: TaskBoardTaskRef): Promise<TaskBoardDeleteResult>;
    /**
     * Read one task synchronously from committed domain memory.
     * @param id - Stable task identity.
     * @returns Detached immutable task, or `undefined` when absent.
     */
    getTask(id: TaskBoardTaskId): TaskBoardTask | undefined;
    /**
     * Read every committed task for package-owned invariant checks.
     * @returns Detached immutable tasks in storage iteration order.
     */
    inspectTasks(): readonly TaskBoardTask[];
    /**
     * Read the global revision used to validate emitted board changes.
     * @returns Current committed global board revision.
     */
    currentBoardRevision(): number;
    /**
     * Wait until operations already admitted for one task and the board have settled.
     * @param id - Task whose operation tail should be observed.
     * @returns Resolution after current tails settle; later operations are not included.
     */
    whenSettled(id: TaskBoardTaskId): Promise<void>;
    private validateCreate;
    private validateEditPatch;
    private resolveText;
    private invalidRequest;
    private resolveRef;
    private resolveSessionRef;
    private mutateOne;
    private commitTask;
    private emitChange;
    private persistUpdatedTask;
    private admitPreparedRound;
    private failAdmission;
    private rpcFailure;
    private stateRejection;
    private scheduleReconcile;
    private reconcileTaskNow;
    private projectSessionEvidence;
    private projectTurnEnd;
    private rebuildActiveSessions;
    private refreshActiveSession;
    private removeActiveSession;
    private requireTask;
    private getRequiredTask;
    private enqueueTask;
    private enqueueBoard;
    private requireGlobal;
    private requireTasks;
}
export default TaskBoardService;
