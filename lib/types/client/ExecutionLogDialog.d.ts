/** Virtualized execution-log dialog for one task round. */
import type { TaskBoardRound, TaskBoardTask, TaskBoardTaskId } from '../types.ts';
import type { TaskBoardClientResult } from './controller.ts';
import type { TaskBoardRoundHistory } from './history.ts';
import type { TaskBoardOverlayProps } from './slots.ts';
interface ExecutionLogDialogProps {
    readonly task: TaskBoardTask;
    readonly round: TaskBoardRound;
    readonly t: TaskBoardOverlayProps['t'];
    readonly load: (round: TaskBoardRound, signal?: AbortSignal) => Promise<TaskBoardRoundHistory>;
    readonly stop: (taskId: TaskBoardTaskId) => Promise<TaskBoardClientResult<TaskBoardTask>>;
    readonly onClose: () => void;
}
/**
 * Load and render one round's exact Session sequence interval.
 * @param props - task, round, loader, and active-round stop action.
 * @returns large execution-log modal.
 */
export declare function ExecutionLogDialog({ task, round, t, load, stop, onClose, }: ExecutionLogDialogProps): import("react").JSX.Element;
export {};
