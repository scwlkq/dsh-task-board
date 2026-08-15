/** Multica-style five-column task-board and compact list view. */
import type { WorkspaceView } from '@deepseek-ai/dsh-client-runtime/client';
import type { TaskBoardStatus, TaskBoardTask, TaskBoardTaskId } from '../types.ts';
import type { TaskBoardDisplayKey, TaskBoardDisplayOptions, TaskBoardViewMode } from './store.ts';
import type { TaskBoardOverlayProps } from './slots.ts';
/** Fixed domain state order rendered in board and filters. */
export declare const TASK_BOARD_STATUSES: readonly TaskBoardStatus[];
interface TaskBoardViewProps {
    readonly tasks: readonly TaskBoardTask[];
    readonly pendingTaskIds: readonly TaskBoardTaskId[];
    readonly workspaces: readonly WorkspaceView[];
    readonly query: string;
    readonly statusFilter: TaskBoardStatus | 'all';
    readonly locationFilter: string;
    readonly agentPresetFilter: string;
    readonly viewMode: TaskBoardViewMode;
    readonly display: TaskBoardDisplayOptions;
    readonly t: TaskBoardOverlayProps['t'];
    readonly onQueryChange: (query: string) => void;
    readonly onStatusFilterChange: (status: TaskBoardStatus | 'all') => void;
    readonly onLocationFilterChange: (location: string) => void;
    readonly onAgentPresetFilterChange: (agentPreset: string) => void;
    readonly onViewModeChange: (mode: TaskBoardViewMode) => void;
    readonly onToggleDisplay: (key: TaskBoardDisplayKey) => void;
    readonly onCreate: (status?: TaskBoardStatus) => void;
    readonly onOpenTask: (taskId: TaskBoardTaskId) => void;
    readonly onReorder: (taskId: TaskBoardTaskId, beforeTaskId?: TaskBoardTaskId) => void | Promise<unknown>;
}
/**
 * Render the task collection with one toolbar and board/list presentations.
 * @param props - authoritative tasks and presentation actions.
 * @returns toolbar plus selected task collection view.
 */
export declare function TaskBoardView({ tasks, pendingTaskIds, workspaces, query, statusFilter, locationFilter, agentPresetFilter, viewMode, display, t, onQueryChange, onStatusFilterChange, onLocationFilterChange, onAgentPresetFilterChange, onViewModeChange, onToggleDisplay, onCreate, onOpenTask, onReorder, }: TaskBoardViewProps): import("react").JSX.Element;
export {};
