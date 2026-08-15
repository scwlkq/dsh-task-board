/** ApiProxy provider for task-board Session admission. @module @deepseek-ai/dsh-task-board-session-apiproxy */
import { TaskBoardSessionGateway } from './session.ts';
import type { TaskBoardSessionCancelRequest, TaskBoardSessionCreateRequest, TaskBoardSessionPromptRequest, TaskBoardSessionResult } from './session-types.ts';
/** Task-board Session provider backed by the Host's ordinary ApiProxy methods. */
export declare class ApiProxyTaskBoardSessionGateway extends TaskBoardSessionGateway {
    static inject: string[];
    /** @inheritdoc */
    create(request: TaskBoardSessionCreateRequest): Promise<TaskBoardSessionResult<{
        readonly sessionId: TaskBoardSessionCreateRequest['sessionId'];
    }>>;
    /** @inheritdoc */
    prompt(request: TaskBoardSessionPromptRequest): Promise<TaskBoardSessionResult<{
        readonly accepted: true;
    }>>;
    /** @inheritdoc */
    cancel(request: TaskBoardSessionCancelRequest): Promise<TaskBoardSessionResult<{
        readonly accepted: true;
    }>>;
}
export default ApiProxyTaskBoardSessionGateway;
