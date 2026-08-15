import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/** Sidebar task-board launcher. */
import { IconChecklistOutline14 } from '@deepseek-ai/dsh-client-ui-primitives';
import css from './TaskBoardLauncher.module.css';
/**
 * Open the task board from the wide sidebar or collapsed rail.
 * @param props - slot runtime, shared store, and task-board hook.
 * @returns launcher button with active-agent count.
 */
export function TaskBoardLauncher({ wide, useStore, actions, useBoard, refresh, t, }) {
    const open = useStore(state => state.open);
    const status = useBoard(view => view.status);
    const active = useBoard(view => view.tasks.filter(task => task.status === 'running').length);
    return (_jsxs("button", { type: "button", className: css.root, "data-wide": wide || undefined, "aria-label": wide ? undefined : t('launcher'), "aria-pressed": open, title: wide ? undefined : t('launcher'), onClick: () => {
            actions.open();
            if (status === 'cold' || status === 'error')
                void refresh();
        }, children: [_jsx("span", { className: css.icon, "aria-hidden": "true", children: _jsx(IconChecklistOutline14, {}) }), wide ? _jsx("span", { className: css.label, children: t('launcher') }) : null, active > 0
                ? (_jsx("span", { className: css.badge, "aria-label": t('launcher.active', { count: active }), children: active }))
                : null] }));
}
