import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/** Full-frame task-board overlay shell. */
import { useEffect } from 'react';
import { IconCloseOutline16, IconRefreshOutline16, } from '@deepseek-ai/dsh-client-ui-primitives';
import { CreateTaskDialog } from "./CreateTaskDialog.js";
import { taskBoardErrorMessage } from "./controller.js";
import { TaskBoardView } from "./TaskBoardView.js";
import { TaskDetail } from "./TaskDetail.js";
import { ExecutionLogDialog } from "./ExecutionLogDialog.js";
import css from './TaskBoardOverlay.module.css';
/**
 * Render the root task-board surface while its shared store is open.
 * @param props - slot runtime, shared store, and Host-backed task projection.
 * @returns full-frame overlay or null while closed.
 */
export function TaskBoardOverlay({ useStore, actions, useBoard, refresh, loadAgentPresets, pickDirectory, uploadAttachment, create, edit, reorder, start, followup, approve, reject, retry, stop, reopen, delete: deleteTask, openSession, loadRoundHistory, useWorkspaces, t, }) {
    const open = useStore(state => state.open);
    const createOpen = useStore(state => state.createOpen);
    const selectedTaskId = useStore(state => state.selectedTaskId);
    const selectedRoundId = useStore(state => state.selectedRoundId);
    const query = useStore(state => state.query);
    const statusFilter = useStore(state => state.statusFilter);
    const locationFilter = useStore(state => state.locationFilter);
    const agentPresetFilter = useStore(state => state.agentPresetFilter);
    const viewMode = useStore(state => state.viewMode);
    const display = useStore(state => state.display);
    const status = useBoard(view => view.status);
    const tasks = useBoard(view => view.tasks);
    const pendingTaskIds = useBoard(view => view.pendingTaskIds);
    const creating = useBoard(view => view.creating);
    const error = useBoard(view => view.error);
    const workspaces = useWorkspaces(state => state.items);
    const selectedTask = selectedTaskId === null
        ? undefined
        : tasks.find(task => task.id === selectedTaskId);
    const selectedRound = selectedRoundId === null
        ? undefined
        : selectedTask?.rounds.find(round => round.id === selectedRoundId);
    useEffect(() => {
        if (open && (status === 'cold' || status === 'error'))
            void refresh();
    }, [open, refresh, status]);
    useEffect(() => {
        if (!open)
            return;
        const onKeyDown = (event) => {
            const target = event.target;
            const editing = target instanceof HTMLInputElement
                || target instanceof HTMLTextAreaElement
                || target instanceof HTMLSelectElement
                || (target instanceof HTMLElement && target.isContentEditable);
            if (event.key === 'Escape' && !createOpen && selectedTaskId === null && selectedRoundId === null) {
                event.preventDefault();
                actions.close();
            }
            else if (event.key === '/' && !editing && !createOpen && selectedTaskId === null) {
                event.preventDefault();
                document.querySelector('[data-task-board-search]')?.focus();
            }
            else if (event.key.toLocaleLowerCase() === 'c' && !editing && !createOpen && selectedTaskId === null) {
                event.preventDefault();
                actions.openCreate();
            }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => { document.removeEventListener('keydown', onKeyDown); };
    }, [actions, createOpen, open, selectedRoundId, selectedTaskId]);
    if (!open)
        return null;
    return (_jsxs("section", { className: css.root, "aria-label": t('board.title'), children: [_jsxs("header", { className: css.header, children: [_jsxs("div", { children: [_jsx("h1", { className: css.title, children: t('board.title') }), _jsx("p", { className: css.subtitle, children: t('board.subtitle') })] }), _jsxs("div", { className: css.actions, children: [_jsx("button", { type: "button", className: css.iconButton, "aria-label": t('board.refresh'), onClick: () => { void refresh(); }, children: _jsx(IconRefreshOutline16, {}) }), _jsx("button", { type: "button", className: css.iconButton, "aria-label": t('board.close'), onClick: () => { actions.close(); }, children: _jsx(IconCloseOutline16, {}) })] })] }), _jsx("div", { className: css.body, children: status === 'loading' || status === 'cold'
                    ? _jsx("p", { className: css.message, children: t('board.loading') })
                    : status === 'error'
                        ? (_jsxs("div", { className: css.error, role: "alert", children: [_jsx("strong", { children: t('board.error') }), _jsx("span", { children: error === null ? '' : taskBoardErrorMessage(error) }), _jsx("button", { type: "button", onClick: () => { void refresh(); }, children: t('board.refresh') })] }))
                        : (_jsx(TaskBoardView, { tasks: tasks, pendingTaskIds: pendingTaskIds, workspaces: workspaces, query: query, statusFilter: statusFilter, locationFilter: locationFilter, agentPresetFilter: agentPresetFilter, viewMode: viewMode, display: display, t: t, onQueryChange: actions.setQuery, onStatusFilterChange: actions.setStatusFilter, onLocationFilterChange: actions.setLocationFilter, onAgentPresetFilterChange: actions.setAgentPresetFilter, onViewModeChange: actions.setViewMode, onToggleDisplay: actions.toggleDisplay, onCreate: actions.openCreate, onOpenTask: (taskId) => { actions.selectTask(taskId); }, onReorder: reorder })) }), _jsx(CreateTaskDialog, { open: createOpen, creating: creating, workspaces: workspaces, t: t, loadAgentPresets: loadAgentPresets, pickDirectory: pickDirectory, uploadAttachment: uploadAttachment, create: create, onClose: () => { actions.closeCreate(); } }), _jsx(TaskDetail, { task: selectedTask, pending: selectedTaskId !== null && pendingTaskIds.includes(selectedTaskId), covered: selectedRound !== undefined, workspaces: workspaces, t: t, onClose: () => { actions.selectTask(null); }, start: start, edit: edit, followup: followup, approve: approve, reject: reject, retry: retry, stop: stop, reopen: reopen, remove: deleteTask, onOpenRound: (roundId) => { actions.selectRound(roundId); }, openSession: openSession }), selectedTask !== undefined && selectedRound !== undefined
                ? (_jsx(ExecutionLogDialog, { task: selectedTask, round: selectedRound, t: t, load: loadRoundHistory, stop: stop, onClose: () => { actions.selectRound(null); } }))
                : null] }));
}
