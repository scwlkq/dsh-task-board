/**
 * Root-scoped presentation state shared by the task-board launcher and overlay.
 * @module @deepseek-ai/dsh-client-ui-task-board/client/store
 */
import { type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client';
import type { TaskBoardRoundId, TaskBoardStatus, TaskBoardTaskId } from '../types.ts';
/** Task collection presentation mode. */
export type TaskBoardViewMode = 'board' | 'list';
/** Optional card metadata controlled from the board toolbar. */
export interface TaskBoardDisplayOptions {
    description: boolean;
    agentPreset: boolean;
    location: boolean;
    rounds: boolean;
    updatedAt: boolean;
}
/** One card display option key. */
export type TaskBoardDisplayKey = keyof TaskBoardDisplayOptions;
/** Shared task-board presentation state. */
export interface TaskBoardUiState {
    open: boolean;
    createOpen: boolean;
    createStatusHint: TaskBoardStatus | null;
    selectedTaskId: TaskBoardTaskId | null;
    selectedRoundId: TaskBoardRoundId | null;
    query: string;
    statusFilter: TaskBoardStatus | 'all';
    locationFilter: string;
    agentPresetFilter: string;
    viewMode: TaskBoardViewMode;
    display: TaskBoardDisplayOptions;
}
type TaskBoardUiActions = {
    open: (draft: TaskBoardUiState) => void;
    close: (draft: TaskBoardUiState) => void;
    openCreate: (draft: TaskBoardUiState, statusHint?: TaskBoardStatus) => void;
    closeCreate: (draft: TaskBoardUiState) => void;
    selectTask: (draft: TaskBoardUiState, taskId: TaskBoardTaskId | null) => void;
    selectRound: (draft: TaskBoardUiState, roundId: TaskBoardRoundId | null) => void;
    setQuery: (draft: TaskBoardUiState, query: string) => void;
    setStatusFilter: (draft: TaskBoardUiState, status: TaskBoardStatus | 'all') => void;
    setLocationFilter: (draft: TaskBoardUiState, location: string) => void;
    setAgentPresetFilter: (draft: TaskBoardUiState, agentPreset: string) => void;
    setViewMode: (draft: TaskBoardUiState, mode: TaskBoardViewMode) => void;
    toggleDisplay: (draft: TaskBoardUiState, key: TaskBoardDisplayKey) => void;
};
/**
 * Create the presentation store handle mounted under both root-scoped slots.
 * @returns a fresh store handle for one plugin application.
 */
export declare function createTaskBoardStore(): EngineStoreHandle<TaskBoardUiState, TaskBoardUiActions>;
export {};
