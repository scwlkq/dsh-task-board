/**
 * Root-scoped presentation state shared by the task-board launcher and overlay.
 * @module @deepseek-ai/dsh-client-ui-task-board/client/store
 */
import { defineStore } from '@deepseek-ai/dsh-client-runtime/client';
/**
 * Create the presentation store handle mounted under both root-scoped slots.
 * @returns a fresh store handle for one plugin application.
 */
export function createTaskBoardStore() {
    return defineStore({
        init: () => ({
            open: false,
            createOpen: false,
            createStatusHint: null,
            selectedTaskId: null,
            selectedRoundId: null,
            query: '',
            statusFilter: 'all',
            locationFilter: 'all',
            agentPresetFilter: 'all',
            viewMode: 'board',
            display: {
                description: true,
                agentPreset: true,
                location: true,
                rounds: true,
                updatedAt: true,
            },
        }),
        actions: {
            open: (draft) => {
                draft.open = true;
            },
            close: (draft) => {
                draft.open = false;
                draft.createOpen = false;
                draft.createStatusHint = null;
                draft.selectedTaskId = null;
                draft.selectedRoundId = null;
            },
            openCreate: (draft, statusHint) => {
                draft.createOpen = true;
                draft.createStatusHint = statusHint ?? null;
            },
            closeCreate: (draft) => {
                draft.createOpen = false;
                draft.createStatusHint = null;
            },
            selectTask: (draft, taskId) => {
                draft.selectedTaskId = taskId;
                if (taskId === null)
                    draft.selectedRoundId = null;
            },
            selectRound: (draft, roundId) => {
                draft.selectedRoundId = roundId;
            },
            setQuery: (draft, query) => {
                draft.query = query;
            },
            setStatusFilter: (draft, status) => {
                draft.statusFilter = status;
            },
            setLocationFilter: (draft, location) => {
                draft.locationFilter = location;
            },
            setAgentPresetFilter: (draft, agentPreset) => {
                draft.agentPresetFilter = agentPreset;
            },
            setViewMode: (draft, mode) => {
                draft.viewMode = mode;
            },
            toggleDisplay: (draft, key) => {
                draft.display[key] = !draft.display[key];
            },
        },
    });
}
