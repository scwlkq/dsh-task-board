/**
 * Task-board browser plugin: one Host-backed controller, one shared root store,
 * and two contributions forming the sidebar launcher and frame overlay.
 * @module @deepseek-ai/dsh-client-ui-task-board/client
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
export type { TaskBoardClientResult, TaskBoardClientStatus, TaskBoardClientView, TaskBoardRemote, } from './controller.ts';
export type { TaskBoardDisplayKey, TaskBoardDisplayOptions, TaskBoardUiState, TaskBoardViewMode, } from './store.ts';
export type { TaskBoardAgentPresetOption, TaskBoardInjected, TaskBoardLauncherProps, TaskBoardOverlayProps, } from './slots.ts';
export { TaskBoardController } from './controller.ts';
export { taskBoardErrorMessage } from './controller.ts';
export { TaskBoardLauncher } from './TaskBoardLauncher.tsx';
export { TaskBoardOverlay } from './TaskBoardOverlay.tsx';
export { createTaskBoardStore } from './store.ts';
export { loadRoundHistory } from './history.ts';
export type { TaskBoardHistoryAssistantRow, TaskBoardHistoryEventRow, TaskBoardHistoryOptions, TaskBoardHistoryRow, TaskBoardRoundHistory, } from './history.ts';
/** Services required by the browser plugin. */
export declare const inject: string[];
/**
 * Register the task-board synchronization layer and both UI entries.
 * @param ctx - Client root context.
 */
export declare function apply(ctx: ClientContext): Promise<void>;
