/** Task-board Session admission capability. @module @deepseek-ai/dsh-task-board-session */
import { Service } from '@deepseek-ai/cordis';
export { TaskBoardSessionRequestId } from "./session-types.js";
/** Provider-neutral Session admission service consumed by the task board. */
export class TaskBoardSessionGateway extends Service {
    /**
     * Bind one provider to `ctx.taskBoardSession`.
     * @param ctx - Cordis context owning the provider.
     */
    constructor(ctx) {
        super(ctx, 'taskBoardSession');
    }
}
export default TaskBoardSessionGateway;
