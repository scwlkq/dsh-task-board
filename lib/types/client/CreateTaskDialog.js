import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/** Agent-first task creation flow. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Modal, } from '@deepseek-ai/dsh-client-ui-primitives';
import { taskBoardErrorMessage, } from "./controller.js";
import css from './CreateTaskDialog.module.css';
const IMAGE_MEDIA_TYPES = new Set([
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
]);
function imageMediaType(value) {
    return IMAGE_MEDIA_TYPES.has(value) ? value : undefined;
}
function createPreviewUrl(file) {
    return typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : undefined;
}
function releaseImages(images) {
    if (typeof URL.revokeObjectURL !== 'function')
        return;
    for (const image of images) {
        if (image.previewUrl !== undefined)
            URL.revokeObjectURL(image.previewUrl);
    }
}
function bytesToBase64(data) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < data.length; offset += chunkSize) {
        binary += String.fromCharCode(...data.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
}
async function readFileBytes(file) {
    if (typeof file.arrayBuffer === 'function')
        return new Uint8Array(await file.arrayBuffer());
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.addEventListener('error', () => { reject(reader.error ?? new Error('file read failed')); });
        reader.addEventListener('load', () => {
            if (!(reader.result instanceof ArrayBuffer)) {
                reject(new Error('file reader returned non-binary data'));
                return;
            }
            resolve(new Uint8Array(reader.result));
        });
        reader.readAsArrayBuffer(file);
    });
}
/**
 * Create one persistent task card and optionally start execution immediately.
 * @param props - visibility, Harness selectors, attachment uploader, and Host create action.
 * @returns controlled creation modal.
 */
export function CreateTaskDialog({ open, creating, workspaces, t, loadAgentPresets, pickDirectory, uploadAttachment, create, onClose, }) {
    const [mode, setMode] = useState('agent');
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [acceptanceCriteria, setAcceptanceCriteria] = useState('');
    const [agentPreset, setAgentPreset] = useState('');
    const [presets, setPresets] = useState([]);
    const [presetStatus, setPresetStatus] = useState('idle');
    const [presetFailure, setPresetFailure] = useState(null);
    const [locationMode, setLocationMode] = useState('workspace');
    const [workspaceId, setWorkspaceId] = useState('');
    const [cwd, setCwd] = useState('');
    const [attachments, setAttachments] = useState([]);
    const attachmentsRef = useRef([]);
    const [continueCreating, setContinueCreating] = useState(false);
    const [failure, setFailure] = useState(null);
    const [pickingDirectory, setPickingDirectory] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const firstWorkspaceId = useMemo(() => workspaces[0]?.workspaceId, [workspaces]);
    const firstWorkspaceIdRef = useRef(firstWorkspaceId);
    const defaultPreset = presets.find(preset => preset.isDefault);
    const busy = creating || submitting;
    useEffect(() => {
        firstWorkspaceIdRef.current = firstWorkspaceId;
    }, [firstWorkspaceId]);
    const replaceAttachments = useCallback((next) => {
        attachmentsRef.current = next;
        setAttachments(next);
    }, []);
    const clearFields = useCallback(() => {
        const defaultWorkspaceId = firstWorkspaceIdRef.current;
        setMode('agent');
        setTitle('');
        setDescription('');
        setAcceptanceCriteria('');
        setAgentPreset('');
        setLocationMode(defaultWorkspaceId === undefined ? 'directory' : 'workspace');
        setWorkspaceId(defaultWorkspaceId === undefined ? '' : String(defaultWorkspaceId));
        setCwd('');
        setFailure(null);
        releaseImages(attachmentsRef.current);
        replaceAttachments([]);
    }, [replaceAttachments]);
    useEffect(() => {
        if (!open)
            return;
        clearFields();
        setContinueCreating(false);
    }, [clearFields, open]);
    useEffect(() => {
        if (!open)
            return;
        setPresetStatus('loading');
        setPresetFailure(null);
        let current = true;
        void loadAgentPresets().then((options) => {
            if (!current)
                return;
            setPresets(options);
            setPresetStatus('ready');
        }, (error) => {
            if (!current)
                return;
            setPresets([]);
            setPresetStatus('error');
            setPresetFailure(error instanceof Error ? error.message : String(error));
        });
        return () => { current = false; };
    }, [loadAgentPresets, open]);
    useEffect(() => {
        if (!open || locationMode !== 'workspace')
            return;
        if (workspaces.some(workspace => String(workspace.workspaceId) === workspaceId))
            return;
        if (firstWorkspaceId === undefined) {
            setLocationMode('directory');
            setWorkspaceId('');
            return;
        }
        setWorkspaceId(String(firstWorkspaceId));
    }, [firstWorkspaceId, locationMode, open, workspaceId, workspaces]);
    useEffect(() => () => {
        releaseImages(attachmentsRef.current);
    }, []);
    const close = () => {
        if (busy || pickingDirectory)
            return;
        clearFields();
        onClose();
    };
    const chooseDirectory = async () => {
        setPickingDirectory(true);
        setFailure(null);
        try {
            const path = await pickDirectory();
            if (path !== null)
                setCwd(path);
        }
        catch (error) {
            setFailure(error instanceof Error ? error.message : String(error));
        }
        finally {
            setPickingDirectory(false);
        }
    };
    const addAttachments = (event) => {
        const files = [...(event.currentTarget.files ?? [])];
        event.currentTarget.value = '';
        if (files.length === 0)
            return;
        const next = [];
        for (const file of files) {
            const mediaType = imageMediaType(file.type);
            if (mediaType === undefined) {
                setFailure(t('create.attachment.unsupported', { name: file.name || t('create.attachment.unnamed') }));
                continue;
            }
            const previewUrl = createPreviewUrl(file);
            next.push({
                id: crypto.randomUUID(),
                file,
                mediaType,
                ...(previewUrl === undefined ? {} : { previewUrl }),
            });
        }
        if (next.length === 0)
            return;
        setFailure(null);
        replaceAttachments([...attachmentsRef.current, ...next]);
    };
    const removeAttachment = (id) => {
        const removed = attachmentsRef.current.find(image => image.id === id);
        if (removed !== undefined)
            releaseImages([removed]);
        replaceAttachments(attachmentsRef.current.filter(image => image.id !== id));
    };
    const uploadImages = async () => {
        const uploaded = [];
        for (const image of attachmentsRef.current) {
            let data;
            try {
                data = bytesToBase64(await readFileBytes(image.file));
            }
            catch {
                setFailure(t('create.attachment.readFailed', { name: image.file.name }));
                return undefined;
            }
            const result = await uploadAttachment({
                mediaType: image.mediaType,
                data,
                ...(image.file.name === '' ? {} : { name: image.file.name }),
            });
            if (!result.ok) {
                setFailure(taskBoardErrorMessage(result.error));
                return undefined;
            }
            uploaded.push(result.value);
        }
        return uploaded;
    };
    const submit = async (start) => {
        const trimmedTitle = title.trim();
        const trimmedDescription = description.trim();
        const trimmedAcceptance = acceptanceCriteria.trim();
        const trimmedPreset = agentPreset.trim();
        const trimmedCwd = cwd.trim();
        if (mode === 'manual' && trimmedTitle === '') {
            setFailure(t('create.validation.title'));
            return;
        }
        if (trimmedDescription === '' && trimmedAcceptance === '') {
            setFailure(t('create.validation.requirement'));
            return;
        }
        /* v8 ignore next 4 -- the enabled Workspace selector synchronizes a current option before user input */
        if (locationMode === 'workspace' && workspaceId === '') {
            setFailure(t('create.validation.workspace'));
            return;
        }
        if (locationMode === 'directory' && trimmedCwd === '') {
            setFailure(t('create.validation.cwd'));
            return;
        }
        setSubmitting(true);
        setFailure(null);
        try {
            const uploaded = await uploadImages();
            if (uploaded === undefined)
                return;
            const request = {
                ...(trimmedTitle === '' ? {} : { title: trimmedTitle }),
                description: trimmedDescription,
                acceptanceCriteria: trimmedAcceptance,
                ...(locationMode === 'workspace'
                    ? { workspaceId: workspaceId }
                    : { cwd: trimmedCwd }),
                ...(trimmedPreset === '' ? {} : { agentPreset: trimmedPreset }),
                ...(uploaded.length === 0 ? {} : { attachments: uploaded }),
                start,
            };
            const result = await create(request);
            if (!result.ok) {
                setFailure(taskBoardErrorMessage(result.error));
                return;
            }
            clearFields();
            if (!continueCreating)
                onClose();
        }
        finally {
            setSubmitting(false);
        }
    };
    return (_jsxs(Modal, { open: open, onClose: close, title: t('create.title'), closeLabel: t('create.close'), className: css.dialog, contentClassName: css.content, footer: (_jsxs(_Fragment, { children: [_jsxs("label", { className: css.continue, children: [_jsx("input", { type: "checkbox", checked: continueCreating, disabled: busy, onChange: (event) => { setContinueCreating(event.currentTarget.checked); } }), _jsx("span", { children: t('create.continue') })] }), _jsx(Button, { variant: "outline", disabled: busy, onClick: () => { void submit(false); }, children: t('create.only') }), _jsx(Button, { disabled: busy, onClick: () => { void submit(true); }, children: t('create.start') })] })), children: [_jsxs("div", { className: css.tabs, role: "tablist", "aria-label": t('create.mode'), children: [_jsx("button", { type: "button", role: "tab", "aria-selected": mode === 'agent', disabled: busy, onClick: () => { setMode('agent'); setFailure(null); }, children: t('create.mode.agent') }), _jsx("button", { type: "button", role: "tab", "aria-selected": mode === 'manual', disabled: busy, onClick: () => { setMode('manual'); setFailure(null); }, children: t('create.mode.manual') })] }), _jsxs("div", { className: css.form, "aria-busy": busy || undefined, children: [_jsxs("label", { className: css.field, children: [_jsxs("span", { children: [t('create.title.field'), mode === 'agent' ? _jsx("small", { children: t('create.title.optional') }) : null] }), _jsx("input", { "aria-label": t('create.title.field'), value: title, disabled: busy, onChange: (event) => { setTitle(event.currentTarget.value); } })] }), _jsxs("div", { className: css.locationGroup, children: [_jsx("span", { className: css.groupLabel, children: t('create.location') }), _jsxs("label", { children: [_jsx("input", { type: "radio", name: "task-location", checked: locationMode === 'workspace', disabled: busy || workspaces.length === 0, onChange: () => { setLocationMode('workspace'); } }), _jsx("span", { children: t('create.location.workspace') })] }), _jsxs("label", { children: [_jsx("input", { type: "radio", name: "task-location", checked: locationMode === 'directory', disabled: busy, onChange: () => { setLocationMode('directory'); } }), _jsx("span", { children: t('create.location.directory') })] })] }), locationMode === 'workspace'
                        ? (_jsxs("label", { className: css.field, children: [_jsx("span", { children: t('create.workspace') }), _jsx("select", { "aria-label": t('create.workspace'), value: workspaceId, disabled: busy, onChange: (event) => { setWorkspaceId(event.currentTarget.value); }, children: workspaces.map(workspace => (_jsxs("option", { value: workspace.workspaceId, children: [workspace.title, " \u2014 ", workspace.path] }, workspace.workspaceId))) })] }))
                        : (_jsxs("div", { className: css.field, children: [_jsx("span", { children: t('create.cwd') }), _jsxs("div", { className: css.inputRow, children: [_jsx("input", { "aria-label": t('create.cwd'), value: cwd, disabled: busy, placeholder: "/path/to/project", onChange: (event) => { setCwd(event.currentTarget.value); } }), _jsx("button", { type: "button", className: css.secondaryButton, disabled: busy || pickingDirectory, onClick: () => { void chooseDirectory(); }, children: pickingDirectory ? t('create.cwd.picking') : t('create.cwd.pick') })] })] })), _jsxs("label", { className: css.field, children: [_jsx("span", { children: t('create.agentPreset') }), _jsxs("select", { "aria-label": t('create.agentPreset'), value: agentPreset, disabled: busy || presetStatus === 'loading', onChange: (event) => { setAgentPreset(event.currentTarget.value); }, children: [_jsx("option", { value: "", children: presetStatus === 'loading'
                                            ? t('create.agentPreset.loading')
                                            : defaultPreset === undefined
                                                ? t('create.agentPreset.default')
                                                : t('create.agentPreset.defaultNamed', { name: defaultPreset.name ?? defaultPreset.id }) }), presets.map(preset => (_jsx("option", { value: preset.id, children: preset.name === undefined ? preset.id : `${preset.name} — ${preset.id}` }, preset.id)))] }), presetFailure === null ? null : _jsx("small", { className: css.fieldHint, children: presetFailure })] }), _jsxs("label", { className: css.field, children: [_jsx("span", { children: t('create.description') }), _jsx("textarea", { "aria-label": t('create.description'), value: description, rows: 5, autoFocus: true, disabled: busy, onChange: (event) => { setDescription(event.currentTarget.value); } })] }), _jsxs("label", { className: css.field, children: [_jsx("span", { children: t('create.acceptance') }), _jsx("textarea", { "aria-label": t('create.acceptance'), value: acceptanceCriteria, rows: 3, disabled: busy, onChange: (event) => { setAcceptanceCriteria(event.currentTarget.value); } })] }), _jsxs("div", { className: css.attachments, children: [_jsxs("div", { className: css.attachmentHeading, children: [_jsx("span", { children: t('create.attachments') }), _jsx("small", { children: t('create.attachments.hint') })] }), _jsxs("label", { className: css.attachmentPicker, "data-disabled": busy || undefined, children: [_jsx("input", { type: "file", accept: "image/png,image/jpeg,image/webp,image/gif", multiple: true, disabled: busy, "aria-label": t('create.attachment.add'), onChange: addAttachments }), _jsx("span", { children: t('create.attachment.add') })] }), attachments.length === 0
                                ? null
                                : (_jsx("ul", { className: css.attachmentList, children: attachments.map(image => (_jsxs("li", { className: css.attachmentItem, children: [image.previewUrl === undefined
                                                ? _jsx("span", { className: css.imageFallback, children: "IMG" })
                                                : _jsx("img", { src: image.previewUrl, alt: "" }), _jsx("span", { className: css.attachmentName, children: image.file.name || t('create.attachment.unnamed') }), _jsx("button", { type: "button", disabled: busy, "aria-label": t('create.attachment.remove', { name: image.file.name || t('create.attachment.unnamed') }), onClick: () => { removeAttachment(image.id); }, children: t('create.attachment.remove.button') })] }, image.id))) }))] }), failure === null ? null : _jsx("div", { className: css.failure, role: "alert", children: failure })] })] }));
}
