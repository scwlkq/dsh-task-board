import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/** Persistent task detail with workflow-specific actions. */
import { useEffect, useState } from 'react';
import { Button, Modal, RiskConfirmation, } from '@deepseek-ai/dsh-client-ui-primitives';
import { taskBoardErrorMessage } from "./controller.js";
import css from './TaskDetail.module.css';
/**
 * Render the selected card as a document with a right-side property rail.
 * @param props - selected card and Host workflow actions.
 * @returns controlled task detail modal.
 */
export function TaskDetail({ task, pending, covered, workspaces, t, onClose, start, edit, followup, approve, reject, retry, stop, reopen, remove, onOpenRound, openSession, }) {
    const [feedback, setFeedback] = useState('');
    const [followupText, setFollowupText] = useState('');
    const [failure, setFailure] = useState(null);
    const [freshSessionOpen, setFreshSessionOpen] = useState(false);
    const [freshSessionAcknowledged, setFreshSessionAcknowledged] = useState(false);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [deleteAcknowledged, setDeleteAcknowledged] = useState(false);
    const [editOpen, setEditOpen] = useState(false);
    const [editTitle, setEditTitle] = useState(task?.title ?? '');
    const [editDescription, setEditDescription] = useState(task?.description ?? '');
    const [editAcceptance, setEditAcceptance] = useState(task?.acceptanceCriteria ?? '');
    const nestedDialogOpen = covered || freshSessionOpen || deleteOpen || editOpen;
    useEffect(() => {
        setFeedback('');
        setFollowupText('');
        setFailure(null);
        setFreshSessionOpen(false);
        setFreshSessionAcknowledged(false);
        setDeleteOpen(false);
        setDeleteAcknowledged(false);
        setEditOpen(false);
        setEditTitle(task?.title ?? '');
        setEditDescription(task?.description ?? '');
        setEditAcceptance(task?.acceptanceCriteria ?? '');
    }, [task?.id]);
    if (task === undefined)
        return null;
    const latestFailure = task.rounds.at(-1)?.failure ?? task.lastStartFailure;
    const workspace = task.workspaceId === undefined
        ? undefined
        : workspaces.find(item => item.workspaceId === task.workspaceId);
    const run = async (operation) => {
        setFailure(null);
        const result = await operation;
        if (result.ok)
            return true;
        setFailure(taskBoardErrorMessage(result.error));
        return false;
    };
    const retryTask = async () => {
        setFailure(null);
        const result = await retry(task.id, false);
        if (result.ok)
            return;
        if (result.error.code === 'fresh-session-required') {
            setFreshSessionOpen(true);
            return;
        }
        setFailure(taskBoardErrorMessage(result.error));
    };
    const retryFresh = async () => {
        const result = await retry(task.id, true);
        if (result.ok) {
            setFreshSessionOpen(false);
            setFreshSessionAcknowledged(false);
            return;
        }
        setFailure(taskBoardErrorMessage(result.error));
    };
    const deleteTask = async () => {
        const result = await remove(task.id);
        if (result.ok) {
            setDeleteOpen(false);
            onClose();
            return;
        }
        setFailure(taskBoardErrorMessage(result.error));
    };
    const saveEdit = async () => {
        const patch = {
            title: editTitle.trim(),
            description: editDescription.trim(),
            acceptanceCriteria: editAcceptance.trim(),
        };
        const result = await edit(task.id, patch);
        if (result.ok) {
            setEditOpen(false);
            return;
        }
        setFailure(taskBoardErrorMessage(result.error));
    };
    return (_jsxs(Modal, { open: true, onClose: () => { if (!nestedDialogOpen)
            onClose(); }, title: `${task.identifier} ${task.title}`, closeLabel: t('detail.close'), className: css.dialog, contentClassName: css.content, children: [_jsxs("div", { className: css.layout, children: [_jsxs("main", { className: css.document, children: [task.status !== 'running'
                                ? _jsx(Button, { variant: "outline", size: "sm", onClick: () => { setEditOpen(true); }, children: t('detail.edit') })
                                : null, _jsxs("section", { children: [_jsx("h3", { children: t('detail.requirement') }), _jsx("p", { children: task.description || '—' })] }), _jsxs("section", { children: [_jsx("h3", { children: t('detail.acceptance') }), _jsx("p", { children: task.acceptanceCriteria || '—' })] }), task.status === 'running'
                                ? (_jsxs("section", { className: css.actionPanel, children: [_jsx("h3", { children: t('detail.followup') }), _jsx("textarea", { "aria-label": t('detail.followup'), rows: 3, value: followupText, onChange: (event) => { setFollowupText(event.currentTarget.value); } }), _jsxs("div", { className: css.actionRow, children: [_jsx(Button, { variant: "primary", disabled: pending || followupText.trim() === '', onClick: () => {
                                                        void run(followup(task.id, followupText.trim())).then((ok) => { if (ok)
                                                            setFollowupText(''); });
                                                    }, children: t('detail.followup.send') }), _jsx(Button, { variant: "outline", disabled: pending, onClick: () => { void run(stop(task.id)); }, children: t('detail.stop') })] })] }))
                                : null, task.status === 'review'
                                ? (_jsxs("section", { className: css.reviewPanel, children: [_jsx("h3", { children: t('detail.review') }), _jsx("div", { className: css.actionRow, children: _jsx(Button, { variant: "primary", disabled: pending, onClick: () => { void run(approve(task.id)); }, children: t('detail.approve') }) }), _jsxs("label", { children: [_jsx("span", { children: t('detail.reject.feedback') }), _jsx("textarea", { "aria-label": t('detail.reject.feedback'), rows: 3, value: feedback, onChange: (event) => { setFeedback(event.currentTarget.value); } })] }), _jsx(Button, { variant: "outline", disabled: pending || feedback.trim() === '', onClick: () => { void run(reject(task.id, feedback.trim())); }, children: t('detail.reject') })] }))
                                : null, task.status === 'failed'
                                ? (_jsxs("section", { className: css.failurePanel, children: [_jsx("h3", { children: t('detail.failure') }), _jsx("strong", { children: latestFailure?.code ?? t('card.failed') }), _jsx("p", { children: latestFailure?.message ?? t('detail.failure.unknown') }), _jsx(Button, { variant: "primary", disabled: pending, onClick: () => { void retryTask(); }, children: t('detail.retry') })] }))
                                : null, task.status === 'initialized'
                                ? _jsx(Button, { variant: "primary", disabled: pending, onClick: () => { void run(start(task.id)); }, children: t('detail.start') })
                                : null, task.status === 'done'
                                ? _jsx(Button, { variant: "outline", disabled: pending, onClick: () => { void run(reopen(task.id)); }, children: t('detail.reopen') })
                                : null, task.status !== 'running'
                                ? _jsx(Button, { variant: "ghost", disabled: pending, onClick: () => { setDeleteOpen(true); }, children: t('detail.delete') })
                                : null, failure === null ? null : _jsx("div", { className: css.inlineFailure, role: "alert", children: failure }), _jsxs("section", { children: [_jsx("h3", { children: t('detail.activity') }), _jsxs("ol", { className: css.timeline, children: [[...task.activity].reverse().map(activity => (_jsxs("li", { children: [_jsx("span", { children: new Date(activity.at).toLocaleString() }), _jsx("strong", { children: t(`activity.${activity.operation}`) })] }, activity.id))), task.activity.length === 0 ? _jsx("li", { children: t('detail.activity.empty') }) : null] })] })] }), _jsxs("aside", { className: css.rail, children: [_jsxs("dl", { children: [_jsxs("div", { children: [_jsx("dt", { children: t('detail.status') }), _jsx("dd", { children: t(`status.${task.status}`) })] }), _jsxs("div", { children: [_jsx("dt", { children: t('detail.agent') }), _jsx("dd", { children: task.agentPreset ?? '—' })] }), _jsxs("div", { children: [_jsx("dt", { children: t('detail.location') }), _jsx("dd", { children: workspace?.title ?? task.cwd ?? '—' })] }), _jsxs("div", { children: [_jsx("dt", { children: t('detail.rounds') }), _jsx("dd", { children: task.rounds.length })] }), _jsxs("div", { children: [_jsx("dt", { children: t('detail.created') }), _jsx("dd", { children: new Date(task.createdAt).toLocaleString() })] }), _jsxs("div", { children: [_jsx("dt", { children: t('detail.updated') }), _jsx("dd", { children: new Date(task.updatedAt).toLocaleString() })] })] }), _jsxs("section", { children: [_jsx("h3", { children: t('detail.sessions') }), task.rounds.map(round => (_jsxs("div", { className: css.roundGroup, children: [_jsxs("button", { type: "button", className: css.round, "aria-label": t('log.open', { ordinal: round.ordinal }), onClick: () => { onOpenRound(round.id); }, children: [_jsxs("span", { children: ["#", round.ordinal, " \u00B7 ", round.trigger] }), _jsx("strong", { children: round.status })] }), _jsx("button", { type: "button", className: css.sessionLink, onClick: () => { onClose(); openSession(round.sessionId); }, children: round.sessionId })] }, round.id))), task.rounds.length === 0 ? _jsx("p", { children: "\u2014" }) : null] })] })] }), _jsx(RiskConfirmation, { open: freshSessionOpen, title: t('detail.retry.fresh.title'), description: t('detail.retry.fresh.description'), acknowledgeLabel: t('detail.retry.fresh.acknowledge'), cancelLabel: t('detail.cancel'), confirmLabel: t('detail.retry.fresh.confirm'), acknowledged: freshSessionAcknowledged, disabled: pending, onAcknowledgedChange: setFreshSessionAcknowledged, onCancel: () => { setFreshSessionOpen(false); setFreshSessionAcknowledged(false); }, onConfirm: () => { void retryFresh(); } }), _jsx(RiskConfirmation, { open: deleteOpen, title: t('detail.delete.title'), description: t('detail.delete.description'), acknowledgeLabel: t('detail.delete.acknowledge'), cancelLabel: t('detail.cancel'), confirmLabel: t('detail.delete.confirm'), acknowledged: deleteAcknowledged, disabled: pending, onAcknowledgedChange: setDeleteAcknowledged, onCancel: () => { setDeleteOpen(false); setDeleteAcknowledged(false); }, onConfirm: () => { void deleteTask(); } }), _jsx(Modal, { open: editOpen, onClose: () => { setEditOpen(false); }, title: t('detail.edit.title', { identifier: task.identifier }), closeLabel: t('detail.cancel'), className: css.editDialog, footer: (_jsxs(_Fragment, { children: [_jsx(Button, { variant: "outline", onClick: () => { setEditOpen(false); }, children: t('detail.cancel') }), _jsx(Button, { variant: "primary", disabled: pending || editTitle.trim() === '', onClick: () => { void saveEdit(); }, children: t('detail.edit.save') })] })), children: _jsxs("div", { className: css.editForm, children: [_jsxs("label", { children: [_jsx("span", { children: t('create.title.field') }), _jsx("input", { "aria-label": t('create.title.field'), value: editTitle, onChange: (event) => { setEditTitle(event.currentTarget.value); } })] }), _jsxs("label", { children: [_jsx("span", { children: t('create.description') }), _jsx("textarea", { "aria-label": t('create.description'), rows: 5, value: editDescription, onChange: (event) => { setEditDescription(event.currentTarget.value); } })] }), _jsxs("label", { children: [_jsx("span", { children: t('create.acceptance') }), _jsx("textarea", { "aria-label": t('create.acceptance'), rows: 4, value: editAcceptance, onChange: (event) => { setEditAcceptance(event.currentTarget.value); } })] })] }) })] }));
}
