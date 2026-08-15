/** Task-board Session admission capability. @module @deepseek-ai/dsh-task-board-session */
import { Context, Service } from '@deepseek-ai/cordis';
import type { TaskBoardSessionCancelRequest, TaskBoardSessionCreateRequest, TaskBoardSessionPromptRequest, TaskBoardSessionResult } from './session-types.ts';
export { TaskBoardSessionRequestId } from './session-types.ts';
export type { TaskBoardSessionCancelRequest, TaskBoardSessionContentPart, TaskBoardSessionCreateRequest, TaskBoardSessionFailure, TaskBoardSessionPromptRequest, TaskBoardSessionRequestId as TaskBoardSessionRequestIdType, TaskBoardSessionResult, } from './session-types.ts';
declare module '@deepseek-ai/cordis' {
    interface Context {
        /** Session admission provider used by task-board workflow execution. */
        taskBoardSession: TaskBoardSessionGateway;
    }
}
/** Provider-neutral Session admission service consumed by the task board. */
export declare abstract class TaskBoardSessionGateway extends Service {
    /**
     * Bind one provider to `ctx.taskBoardSession`.
     * @param ctx - Cordis context owning the provider.
     */
    constructor(ctx: Context);
    /**
     * Create the Session reserved by a task-board round.
     * @param request - Session identity and optional composition settings.
     * @returns Provider result after Session creation admission.
     */
    abstract create(request: TaskBoardSessionCreateRequest): Promise<TaskBoardSessionResult<{
        readonly sessionId: TaskBoardSessionCreateRequest['sessionId'];
    }>>;
    /**
     * Enqueue one task-board prompt through the ordinary Session prompt path.
     * @param request - Session identity, request identity, and prompt parts.
     * @returns Provider result after prompt admission.
     */
    abstract prompt(request: TaskBoardSessionPromptRequest): Promise<TaskBoardSessionResult<{
        readonly accepted: true;
    }>>;
    /**
     * Cancel the current turn of a task-board Session.
     * @param request - Session and request identities.
     * @returns Provider result after cancellation admission.
     */
    abstract cancel(request: TaskBoardSessionCancelRequest): Promise<TaskBoardSessionResult<{
        readonly accepted: true;
    }>>;
}
export default TaskBoardSessionGateway;
