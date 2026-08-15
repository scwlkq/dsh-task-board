/** Persistent task detail with workflow-specific actions. */
import type { WorkspaceView } from '@deepseek-ai/dsh-client-runtime/client';
import type { TaskBoardEditPatch, TaskBoardRound, TaskBoardTask, TaskBoardTaskId } from '../types.ts';
import { type TaskBoardClientResult } from './controller.ts';
import type { TaskBoardOverlayProps } from './slots.ts';
interface TaskDetailProps {
    readonly task: TaskBoardTask | undefined;
    readonly pending: boolean;
    readonly covered: boolean;
    readonly workspaces: readonly WorkspaceView[];
    readonly t: TaskBoardOverlayProps['t'];
    readonly onClose: () => void;
    readonly start: (id: TaskBoardTaskId) => Promise<TaskBoardClientResult<TaskBoardTask>>;
    readonly edit: (id: TaskBoardTaskId, patch: TaskBoardEditPatch) => Promise<TaskBoardClientResult<TaskBoardTask>>;
    readonly followup: (id: TaskBoardTaskId, text: string) => Promise<TaskBoardClientResult<TaskBoardTask>>;
    readonly approve: (id: TaskBoardTaskId) => Promise<TaskBoardClientResult<TaskBoardTask>>;
    readonly reject: (id: TaskBoardTaskId, feedback: string) => Promise<TaskBoardClientResult<TaskBoardTask>>;
    readonly retry: (id: TaskBoardTaskId, allowFresh: boolean) => Promise<TaskBoardClientResult<TaskBoardTask>>;
    readonly stop: (id: TaskBoardTaskId) => Promise<TaskBoardClientResult<TaskBoardTask>>;
    readonly reopen: (id: TaskBoardTaskId) => Promise<TaskBoardClientResult<TaskBoardTask>>;
    readonly remove: TaskBoardOverlayProps['delete'];
    readonly onOpenRound: (roundId: TaskBoardRound['id']) => void;
    readonly openSession: TaskBoardOverlayProps['openSession'];
}
/**
 * Render the selected card as a document with a right-side property rail.
 * @param props - selected card and Host workflow actions.
 * @returns controlled task detail modal.
 */
export declare function TaskDetail({ task, pending, covered, workspaces, t, onClose, start, edit, followup, approve, reject, retry, stop, reopen, remove, onOpenRound, openSession, }: TaskDetailProps): import("react").JSX.Element | null;
export {};
