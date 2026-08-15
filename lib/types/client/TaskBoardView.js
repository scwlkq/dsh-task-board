import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/** Multica-style five-column task-board and compact list view. */
import { useMemo, useState } from 'react';
import { closestCenter, DndContext, DragOverlay, KeyboardSensor, PointerSensor, useDroppable, useSensor, useSensors, } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy, } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import clsx from 'clsx';
import { IconAgentPresetOutline16, IconChecklistOutline14, IconPlusOutline16, IconSearchOutline16, Input, } from '@deepseek-ai/dsh-client-ui-primitives';
import { resolveTaskDrop, TASK_BOARD_COLUMN_PREFIX, } from "./drag.js";
import css from './TaskBoardView.module.css';
/** Fixed domain state order rendered in board and filters. */
export const TASK_BOARD_STATUSES = [
    'initialized',
    'running',
    'review',
    'done',
    'failed',
];
function statusLabel(status, t) {
    return t(`status.${status}`);
}
function failureMessage(task) {
    return task.rounds.at(-1)?.failure?.message ?? task.lastStartFailure?.message;
}
function workspaceLabel(workspaceId, workspaces) {
    return workspaces.find(workspace => workspace.workspaceId === workspaceId)?.title
        ?? String(workspaceId);
}
function locationLabel(task, workspaces) {
    if (task.workspaceId !== undefined) {
        return workspaceLabel(task.workspaceId, workspaces);
    }
    return task.cwd;
}
function matches(task, query) {
    const normalized = query.trim().toLocaleLowerCase();
    if (normalized === '')
        return true;
    return [task.identifier, task.title, task.description, task.acceptanceCriteria]
        .some(value => value.toLocaleLowerCase().includes(normalized));
}
function TaskCard({ task, pending, display, workspaces, t, overlay = false, onOpen, }) {
    const sortable = useSortable({ id: task.id, disabled: overlay || pending });
    const style = overlay
        ? undefined
        : {
            transform: CSS.Transform.toString(sortable.transform),
            transition: sortable.transition,
        };
    const location = locationLabel(task, workspaces);
    const failure = failureMessage(task);
    const running = task.status === 'running';
    const starting = task.rounds.at(-1)?.status === 'starting';
    return (_jsxs("article", { ref: overlay ? undefined : sortable.setNodeRef, style: style, className: clsx(css.card, overlay && css.cardOverlay, pending && css.cardPending), "data-status": task.status, children: [overlay
                ? null
                : (_jsxs("button", { type: "button", className: css.dragHandle, "aria-label": t('card.drag', { identifier: task.identifier }), ...sortable.attributes, ...sortable.listeners, children: [_jsx("span", {}), _jsx("span", {}), _jsx("span", {})] })), _jsxs("button", { type: "button", className: css.cardButton, "aria-label": `${task.identifier} ${task.title}`, onClick: onOpen, children: [_jsx("span", { className: css.identifier, children: task.identifier }), running
                        ? (_jsxs("span", { className: css.liveBadge, children: [_jsx("span", { className: css.liveDot }), t(starting ? 'card.starting' : 'card.running')] }))
                        : null, _jsx("strong", { className: css.cardTitle, children: task.title }), display.description && task.description !== ''
                        ? _jsx("span", { className: css.description, children: task.description })
                        : null, task.status === 'failed' && failure !== undefined
                        ? _jsx("span", { className: css.failure, children: failure })
                        : null, _jsxs("span", { className: css.meta, children: [display.agentPreset && task.agentPreset !== undefined
                                ? (_jsxs("span", { className: css.metaItem, children: [_jsx(IconAgentPresetOutline16, { size: 12 }), task.agentPreset] }))
                                : null, display.location && location !== undefined
                                ? _jsx("span", { className: css.location, title: location, children: location })
                                : null, display.rounds ? _jsx("span", { children: t('card.rounds', { count: task.rounds.length }) }) : null, display.updatedAt ? _jsx("span", { className: css.updated, children: t('card.updated') }) : null] })] })] }));
}
function BoardColumn({ status, tasks, pendingTaskIds, display, workspaces, t, onCreate, onOpenTask, }) {
    const columnId = `${TASK_BOARD_COLUMN_PREFIX}${status}`;
    const drop = useDroppable({ id: columnId });
    return (_jsxs("section", { ref: drop.setNodeRef, className: css.column, "data-status": status, "data-over": drop.isOver || undefined, children: [_jsxs("header", { className: css.columnHeader, children: [_jsx("span", { className: css.statusDot }), _jsx("h2", { children: statusLabel(status, t) }), _jsx("span", { className: css.count, children: tasks.length }), _jsx("button", { type: "button", className: css.columnAdd, "aria-label": `${t('column.create')} ${statusLabel(status, t)}`, onClick: onCreate, children: _jsx(IconPlusOutline16, {}) })] }), _jsx(SortableContext, { items: tasks.map(task => task.id), strategy: verticalListSortingStrategy, children: _jsxs("div", { className: css.cards, children: [tasks.map(task => (_jsx(TaskCard, { task: task, pending: pendingTaskIds.includes(task.id), display: display, workspaces: workspaces, t: t, onOpen: () => { onOpenTask(task.id); } }, task.id))), tasks.length === 0
                            ? (_jsxs("button", { type: "button", className: css.emptyColumn, onClick: onCreate, children: [_jsx(IconPlusOutline16, {}), t('column.empty')] }))
                            : null] }) })] }));
}
const DISPLAY_KEYS = [
    ['description', '描述'],
    ['agentPreset', 'Agent Preset'],
    ['location', 'Workspace / 目录'],
    ['rounds', '执行轮次'],
    ['updatedAt', '更新时间'],
];
/**
 * Render the task collection with one toolbar and board/list presentations.
 * @param props - authoritative tasks and presentation actions.
 * @returns toolbar plus selected task collection view.
 */
export function TaskBoardView({ tasks, pendingTaskIds, workspaces, query, statusFilter, locationFilter, agentPresetFilter, viewMode, display, t, onQueryChange, onStatusFilterChange, onLocationFilterChange, onAgentPresetFilterChange, onViewModeChange, onToggleDisplay, onCreate, onOpenTask, onReorder, }) {
    const [displayOpen, setDisplayOpen] = useState(false);
    const [activeTaskId, setActiveTaskId] = useState(null);
    const [dragFeedback, setDragFeedback] = useState(null);
    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
    const locationOptions = useMemo(() => [...new Map(tasks.flatMap((task) => {
            if (task.workspaceId !== undefined) {
                const value = `workspace:${task.workspaceId}`;
                return [[value, workspaceLabel(task.workspaceId, workspaces)]];
            }
            if (task.cwd !== undefined)
                return [[`cwd:${task.cwd}`, task.cwd]];
            return [];
        })).entries()], [tasks, workspaces]);
    const agentOptions = useMemo(() => [...new Set(tasks.flatMap(task => task.agentPreset === undefined ? [] : [task.agentPreset]))].sort(), [tasks]);
    const filtered = useMemo(() => tasks.filter((task) => {
        const taskLocation = task.workspaceId !== undefined
            ? `workspace:${task.workspaceId}`
            : task.cwd === undefined ? 'none' : `cwd:${task.cwd}`;
        return (statusFilter === 'all' || task.status === statusFilter)
            && (locationFilter === 'all' || taskLocation === locationFilter)
            && (agentPresetFilter === 'all' || task.agentPreset === agentPresetFilter)
            && matches(task, query);
    }), [agentPresetFilter, locationFilter, query, statusFilter, tasks]);
    const activeTask = activeTaskId === null ? undefined : tasks.find(task => task.id === activeTaskId);
    const handleDragStart = (event) => {
        setDragFeedback(null);
        setActiveTaskId(event.active.id);
    };
    const handleDragEnd = (event) => {
        setActiveTaskId(null);
        if (event.over === null)
            return;
        const resolution = resolveTaskDrop(tasks, event.active.id, String(event.over.id));
        if (resolution.kind === 'forbidden') {
            setDragFeedback(t('drag.forbidden'));
            return;
        }
        if (resolution.kind === 'reorder')
            void onReorder(event.active.id, resolution.beforeTaskId);
    };
    return (_jsxs("div", { className: css.root, children: [_jsxs("div", { className: css.toolbar, children: [_jsxs("button", { type: "button", className: css.primaryAction, onClick: () => { onCreate(); }, children: [_jsx(IconPlusOutline16, {}), t('board.new')] }), _jsx(Input, { type: "search", role: "searchbox", "aria-label": t('board.search.aria'), placeholder: t('board.search'), value: query, icon: _jsx(IconSearchOutline16, {}), "data-task-board-search": true, className: css.search, onChange: (event) => { onQueryChange(event.currentTarget.value); } }), _jsxs("select", { className: css.select, "aria-label": t('filter.status'), value: statusFilter, onChange: (event) => { onStatusFilterChange(event.currentTarget.value); }, children: [_jsx("option", { value: "all", children: t('status.all') }), TASK_BOARD_STATUSES.map(status => (_jsx("option", { value: status, children: statusLabel(status, t) }, status)))] }), _jsxs("select", { className: css.select, "aria-label": t('filter.location'), value: locationFilter, onChange: (event) => { onLocationFilterChange(event.currentTarget.value); }, children: [_jsx("option", { value: "all", children: t('filter.location.all') }), locationOptions.map(([value, label]) => _jsx("option", { value: value, children: label }, value))] }), _jsxs("select", { className: css.select, "aria-label": t('filter.agent'), value: agentPresetFilter, onChange: (event) => { onAgentPresetFilterChange(event.currentTarget.value); }, children: [_jsx("option", { value: "all", children: t('filter.agent.all') }), agentOptions.map(agentPreset => _jsx("option", { value: agentPreset, children: agentPreset }, agentPreset))] }), _jsxs("div", { className: css.displayControl, children: [_jsx("button", { type: "button", className: css.toolbarButton, "aria-expanded": displayOpen, onClick: () => { setDisplayOpen(open => !open); }, children: t('display.button') }), displayOpen
                                ? (_jsx("div", { className: css.displayMenu, children: DISPLAY_KEYS.map(([key, label]) => (_jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: display[key], onChange: () => { onToggleDisplay(key); } }), _jsx("span", { children: label })] }, key))) }))
                                : null] }), _jsxs("div", { className: css.viewSwitch, "aria-label": t('view.switch'), children: [_jsxs("button", { type: "button", "aria-pressed": viewMode === 'board', onClick: () => { onViewModeChange('board'); }, children: [_jsx(IconChecklistOutline14, {}), t('board.view.board')] }), _jsx("button", { type: "button", "aria-pressed": viewMode === 'list', onClick: () => { onViewModeChange('list'); }, children: t('board.view.list') })] })] }), dragFeedback !== null ? _jsx("div", { className: css.dragFeedback, role: "status", children: dragFeedback }) : null, viewMode === 'board'
                ? (_jsxs(DndContext, { sensors: sensors, collisionDetection: closestCenter, onDragStart: handleDragStart, onDragCancel: () => { setActiveTaskId(null); }, onDragEnd: handleDragEnd, children: [_jsx("div", { className: css.board, children: TASK_BOARD_STATUSES.map(status => (_jsx(BoardColumn, { status: status, tasks: filtered.filter(task => task.status === status), pendingTaskIds: pendingTaskIds, display: display, workspaces: workspaces, t: t, onCreate: () => { onCreate(status); }, onOpenTask: onOpenTask }, status))) }), _jsx(DragOverlay, { children: activeTask === undefined
                                ? null
                                : (_jsx(TaskCard, { task: activeTask, pending: false, display: display, workspaces: workspaces, t: t, overlay: true, onOpen: () => { } })) })] }))
                : (_jsx("div", { className: css.tableWrap, children: _jsxs("table", { className: css.table, "aria-label": t('list.aria'), children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: t('list.task') }), _jsx("th", { children: t('list.status') }), _jsx("th", { children: t('list.agent') }), _jsx("th", { children: t('list.location') }), _jsx("th", { children: t('list.rounds') })] }) }), _jsx("tbody", { children: filtered.map(task => (_jsxs("tr", { children: [_jsx("td", { children: _jsxs("button", { type: "button", className: css.listTask, onClick: () => { onOpenTask(task.id); }, children: [_jsx("span", { children: task.identifier }), _jsx("strong", { children: task.title }), display.description ? _jsx("small", { children: task.description }) : null] }) }), _jsx("td", { children: _jsx("span", { className: css.listStatus, "data-status": task.status, children: statusLabel(task.status, t) }) }), _jsx("td", { children: task.agentPreset ?? '—' }), _jsx("td", { children: locationLabel(task, workspaces) ?? '—' }), _jsx("td", { children: task.rounds.length })] }, task.id))) })] }) }))] }));
}
