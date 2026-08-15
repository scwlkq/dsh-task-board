/** Pure task-card drop resolution shared by DnD UI and tests. */
import type { TaskBoardStatus, TaskBoardTask, TaskBoardTaskId } from '../types.ts';
/** Prefix used for empty-column and append drop targets. */
export declare const TASK_BOARD_COLUMN_PREFIX = "task-board-column:";
/** Result of resolving one card drop without mutating workflow state. */
export type TaskDropResolution = {
    readonly kind: 'ignore';
} | {
    readonly kind: 'reorder';
    readonly beforeTaskId?: TaskBoardTaskId;
} | {
    readonly kind: 'forbidden';
    readonly sourceStatus: TaskBoardStatus;
    readonly targetStatus: TaskBoardStatus;
};
/**
 * Resolve DnD intent into a same-column reorder or forbidden state change.
 * @param tasks - current authoritative display ordering.
 * @param activeId - dragged card identity.
 * @param overId - card or column drop target identity.
 * @returns a pure mutation decision.
 */
export declare function resolveTaskDrop(tasks: readonly TaskBoardTask[], activeId: TaskBoardTaskId, overId: TaskBoardTaskId | string): TaskDropResolution;
