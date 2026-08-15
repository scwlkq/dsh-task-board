import { ApiProxyTaskBoardSessionGateway } from "./host/session-apiproxy.js";
import { TaskBoardService } from "./host/service.js";
export { TaskBoardService } from "./host/service.js";
export { TaskBoardSessionGateway } from "./host/session.js";
/** Loader schema shared with the Task Board service. */
export const Config = TaskBoardService.Config;
/**
 * Mount the Session provider before the Task Board authority.
 * @param ctx - Host context used to mount both owned plugins.
 * @param config - Validated Task Board text limits.
 * @returns Async disposer sequence owned by the root plugin effect.
 */
export async function* createTaskBoardComposition(ctx, config) {
    const session = ctx.plugin(ApiProxyTaskBoardSessionGateway);
    await session.await();
    yield session.dispose;
    const taskBoard = ctx.plugin(TaskBoardService, config);
    await taskBoard.await();
    yield taskBoard.dispose;
}
/**
 * Activate the single Loader entry and own both Host plugins.
 * @param ctx - Host Cordis context.
 * @param config - Validated Task Board text limits.
 */
export async function apply(ctx, config) {
    await ctx.effect(() => createTaskBoardComposition(ctx, config), 'task-board.community.composition');
}
