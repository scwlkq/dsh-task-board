import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/** Virtualized execution-log dialog for one task round. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Button, DiffBlock, JsonTree, Modal, TerminalBlock, writeClipboard, } from '@deepseek-ai/dsh-client-ui-primitives';
import css from './ExecutionLogDialog.module.css';
function rowSeq(row) {
    return row.kind === 'event'
        ? [row.entry.event.seq, row.entry.event.seq]
        : [row.startSeq, row.endSeq];
}
function rowMatches(row, filter) {
    if (filter === 'all')
        return true;
    if (row.kind === 'assistant-stream')
        return filter === 'agent';
    const type = row.entry.event.type;
    if (filter === 'agent')
        return type === 'assistant/message';
    if (filter === 'tools')
        return type === 'tool/call' || type === 'tool/result';
    return type === 'turn/end' || (type === 'tool/result' && row.entry.event.data.error !== undefined);
}
function contentText(entry) {
    const event = entry.event;
    const content = event.type === 'user/message'
        ? event.data.content
        : event.type === 'assistant/message'
            ? event.data.message.content
            : undefined;
    if (content === undefined)
        return undefined;
    const text = content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n');
    return text === '' ? undefined : text;
}
function renderIntent(entry) {
    const intent = entry.view;
    if (intent === undefined)
        return null;
    if (intent.for === 'call') {
        const view = intent.view;
        if (view.card === 'terminal')
            return _jsx(TerminalBlock, { command: view.title, cwd: view.cwd, running: true });
        if (view.card === 'diff')
            return _jsx(DiffBlock, { diffs: view.diffs });
        return null;
    }
    const view = intent.view;
    if (view.card === 'terminal') {
        return _jsx(TerminalBlock, { command: view.title ?? 'command', output: view.output, exitCode: view.exitCode, signal: view.signal });
    }
    if (view.card === 'diff')
        return _jsx(DiffBlock, { diffs: view.diffs });
    return null;
}
function EventRow({ row, t }) {
    const [start, end] = rowSeq(row);
    if (row.kind === 'assistant-stream') {
        return (_jsxs("article", { className: css.row, "data-kind": "agent", children: [_jsxs("header", { children: [_jsx("strong", { children: t('log.answer') }), _jsxs("span", { children: ["#", start, "\u2013", end] })] }), row.reasoning === '' ? null : _jsxs("details", { children: [_jsx("summary", { children: t('log.reasoning') }), _jsx("pre", { children: row.reasoning })] }), row.text === '' ? null : _jsx("p", { className: css.agentText, children: row.text })] }));
    }
    const entry = row.entry;
    const text = contentText(entry);
    const intent = renderIntent(entry);
    return (_jsxs("article", { className: css.row, "data-kind": entry.event.type, children: [_jsxs("header", { children: [_jsx("strong", { children: entry.event.type }), _jsxs("span", { children: ["#", start] }), _jsx("time", { children: new Date(entry.event.time).toLocaleTimeString() })] }), text === undefined ? null : _jsx("p", { className: css.messageText, children: text }), intent, text === undefined && intent === null
                ? _jsx(JsonTree, { data: entry.event.data, label: `${entry.event.type} data` })
                : null] }));
}
function copyText(history) {
    return history.rows.map((row) => {
        if (row.kind === 'assistant-stream') {
            return [`#${row.startSeq}-${row.endSeq} assistant`, row.reasoning, row.text].filter(Boolean).join('\n');
        }
        return `#${row.entry.event.seq} ${row.entry.event.type}\n${JSON.stringify(row.entry.event.data, null, 2)}`;
    }).join('\n\n');
}
/**
 * Load and render one round's exact Session sequence interval.
 * @param props - task, round, loader, and active-round stop action.
 * @returns large execution-log modal.
 */
export function ExecutionLogDialog({ task, round, t, load, stop, onClose, }) {
    const [history, setHistory] = useState(null);
    const [error, setError] = useState(null);
    const [filter, setFilter] = useState('all');
    const [order, setOrder] = useState('oldest');
    const scrollRef = useRef(null);
    useEffect(() => {
        const controller = new AbortController();
        setHistory(null);
        setError(null);
        void load(round, controller.signal).then(setHistory, (reason) => {
            if (controller.signal.aborted)
                return;
            setError(reason instanceof Error ? reason.message : String(reason));
        });
        return () => { controller.abort(); };
    }, [load, round]);
    const filtered = useMemo(() => {
        const rows = history?.rows.filter(row => rowMatches(row, filter)) ?? [];
        return order === 'oldest' ? rows : [...rows].reverse();
    }, [filter, history, order]);
    const virtualizer = useVirtualizer({
        count: filtered.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => 120,
        overscan: 6,
        initialRect: { width: 820, height: 520 },
    });
    const virtualItems = virtualizer.getVirtualItems();
    const active = round.status === 'starting' || round.status === 'running';
    const duration = (round.endedAt ?? Date.now()) - round.startedAt;
    const seqStart = history?.startSeq ?? round.startSeq ?? '—';
    const seqEnd = history?.endSeq ?? round.endSeq ?? '…';
    return (_jsxs(Modal, { open: true, onClose: onClose, title: t('log.title', { identifier: task.identifier, ordinal: round.ordinal }), closeLabel: t('log.close'), className: css.dialog, contentClassName: css.content, children: [_jsxs("div", { className: css.meta, children: [_jsxs("span", { children: [_jsx("small", { children: t('log.trigger') }), round.trigger] }), _jsxs("span", { children: [_jsx("small", { children: t('log.status') }), round.status] }), _jsxs("span", { children: [_jsx("small", { children: t('log.session') }), round.sessionId] }), _jsxs("span", { children: [_jsx("small", { children: t('log.duration') }), Math.max(0, Math.round(duration / 1_000)), "s"] }), _jsx("strong", { children: t('log.seq', { start: seqStart, end: seqEnd }) })] }), _jsxs("div", { className: css.toolbar, children: [_jsxs("select", { "aria-label": t('log.filter'), value: filter, onChange: (event) => { setFilter(event.currentTarget.value); }, children: [_jsx("option", { value: "all", children: t('log.filter.all') }), _jsx("option", { value: "agent", children: t('log.filter.agent') }), _jsx("option", { value: "tools", children: t('log.filter.tools') }), _jsx("option", { value: "errors", children: t('log.filter.errors') })] }), _jsx("button", { type: "button", onClick: () => { setOrder(value => value === 'oldest' ? 'newest' : 'oldest'); }, children: t(order === 'oldest' ? 'log.order.oldest' : 'log.order.newest') }), _jsx("button", { type: "button", disabled: history === null, onClick: history === null ? undefined : () => { void writeClipboard(copyText(history)); }, children: t('log.copy') }), active ? _jsx(Button, { size: "sm", variant: "outline", onClick: () => { void stop(task.id); }, children: t('detail.stop') }) : null] }), history?.truncated === true ? _jsx("div", { className: css.truncated, role: "status", children: t('log.truncated') }) : null, error !== null ? _jsxs("div", { className: css.failure, role: "alert", children: [_jsx("strong", { children: t('log.error') }), _jsx("span", { children: error })] }) : null, history === null && error === null ? _jsx("p", { className: css.loading, children: t('log.loading') }) : null, history !== null && filtered.length === 0 ? _jsx("p", { className: css.loading, children: t('log.empty') }) : null, filtered.length > 0
                ? (_jsx("div", { ref: scrollRef, className: css.log, children: _jsx("div", { className: css.virtual, style: { height: virtualizer.getTotalSize() }, children: virtualItems.length === 0
                            ? (_jsx("div", { className: css.fallbackRows, children: filtered.slice(0, 20).map((row) => {
                                    const [start, end] = rowSeq(row);
                                    return _jsx(EventRow, { row: row, t: t }, `${start}:${end}`);
                                }) }))
                            : virtualItems.map((item) => {
                                const row = filtered[item.index];
                                /* v8 ignore next -- TanStack Virtual bounds item indices to the configured count */
                                if (row === undefined)
                                    return null;
                                return (_jsx("div", { ref: virtualizer.measureElement, "data-index": item.index, className: css.virtualRow, style: { transform: `translateY(${item.start}px)` }, children: _jsx(EventRow, { row: row, t: t }) }, item.key));
                            }) }) }))
                : null] }));
}
