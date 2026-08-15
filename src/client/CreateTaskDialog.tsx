/** Agent-first task creation flow. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import {
  Button,
  Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceView } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ImageAttachmentRef,
  ImageMediaType,
} from '@deepseek-ai/dsh-attachment'
import type {
  TaskBoardAttachmentUploadRequest,
  TaskBoardCreateRequest,
  TaskBoardTask,
} from '../types.ts'
import {
  taskBoardErrorMessage,
  type TaskBoardClientResult,
} from './controller.ts'
import type {
  TaskBoardAgentPresetOption,
  TaskBoardOverlayProps,
} from './slots.ts'
import css from './CreateTaskDialog.module.css'

interface CreateTaskDialogProps {
  readonly open: boolean
  readonly creating: boolean
  readonly workspaces: readonly WorkspaceView[]
  readonly t: TaskBoardOverlayProps['t']
  readonly loadAgentPresets: () => Promise<readonly TaskBoardAgentPresetOption[]>
  readonly pickDirectory: () => Promise<string | null>
  readonly uploadAttachment: (
    request: TaskBoardAttachmentUploadRequest,
  ) => Promise<TaskBoardClientResult<ImageAttachmentRef>>
  readonly create: (request: TaskBoardCreateRequest) => Promise<TaskBoardClientResult<TaskBoardTask>>
  readonly onClose: () => void
}

type CreateMode = 'agent' | 'manual'
type LocationMode = 'workspace' | 'directory'
type PresetStatus = 'idle' | 'loading' | 'ready' | 'error'

interface StagedImage {
  readonly id: string
  readonly file: File
  readonly mediaType: ImageMediaType
  readonly previewUrl?: string
}

const IMAGE_MEDIA_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
])

function imageMediaType(value: string): ImageMediaType | undefined {
  return IMAGE_MEDIA_TYPES.has(value) ? value as ImageMediaType : undefined
}

function createPreviewUrl(file: File): string | undefined {
  return typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : undefined
}

function releaseImages(images: readonly StagedImage[]): void {
  if (typeof URL.revokeObjectURL !== 'function') return
  for (const image of images) {
    if (image.previewUrl !== undefined) URL.revokeObjectURL(image.previewUrl)
  }
}

function bytesToBase64(data: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < data.length; offset += chunkSize) {
    binary += String.fromCharCode(...data.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

async function readFileBytes(file: File): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === 'function') return new Uint8Array(await file.arrayBuffer())
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('error', () => { reject(reader.error ?? new Error('file read failed')) })
    reader.addEventListener('load', () => {
      if (!(reader.result instanceof ArrayBuffer)) {
        reject(new Error('file reader returned non-binary data'))
        return
      }
      resolve(new Uint8Array(reader.result))
    })
    reader.readAsArrayBuffer(file)
  })
}

/**
 * Create one persistent task card and optionally start execution immediately.
 * @param props - visibility, Harness selectors, attachment uploader, and Host create action.
 * @returns controlled creation modal.
 */
export function CreateTaskDialog({
  open,
  creating,
  workspaces,
  t,
  loadAgentPresets,
  pickDirectory,
  uploadAttachment,
  create,
  onClose,
}: CreateTaskDialogProps) {
  const [mode, setMode] = useState<CreateMode>('agent')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [acceptanceCriteria, setAcceptanceCriteria] = useState('')
  const [agentPreset, setAgentPreset] = useState('')
  const [presets, setPresets] = useState<readonly TaskBoardAgentPresetOption[]>([])
  const [presetStatus, setPresetStatus] = useState<PresetStatus>('idle')
  const [presetFailure, setPresetFailure] = useState<string | null>(null)
  const [locationMode, setLocationMode] = useState<LocationMode>('workspace')
  const [workspaceId, setWorkspaceId] = useState('')
  const [cwd, setCwd] = useState('')
  const [attachments, setAttachments] = useState<readonly StagedImage[]>([])
  const attachmentsRef = useRef<readonly StagedImage[]>([])
  const [continueCreating, setContinueCreating] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [pickingDirectory, setPickingDirectory] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const firstWorkspaceId = useMemo(() => workspaces[0]?.workspaceId, [workspaces])
  const firstWorkspaceIdRef = useRef(firstWorkspaceId)
  const defaultPreset = presets.find(preset => preset.isDefault)
  const busy = creating || submitting

  useEffect(() => {
    firstWorkspaceIdRef.current = firstWorkspaceId
  }, [firstWorkspaceId])

  const replaceAttachments = useCallback((next: readonly StagedImage[]): void => {
    attachmentsRef.current = next
    setAttachments(next)
  }, [])

  const clearFields = useCallback((): void => {
    const defaultWorkspaceId = firstWorkspaceIdRef.current
    setMode('agent')
    setTitle('')
    setDescription('')
    setAcceptanceCriteria('')
    setAgentPreset('')
    setLocationMode(defaultWorkspaceId === undefined ? 'directory' : 'workspace')
    setWorkspaceId(defaultWorkspaceId === undefined ? '' : String(defaultWorkspaceId))
    setCwd('')
    setFailure(null)
    releaseImages(attachmentsRef.current)
    replaceAttachments([])
  }, [replaceAttachments])

  useEffect(() => {
    if (!open) return
    clearFields()
    setContinueCreating(false)
  }, [clearFields, open])

  useEffect(() => {
    if (!open) return
    setPresetStatus('loading')
    setPresetFailure(null)
    let current = true
    void loadAgentPresets().then(
      (options) => {
        if (!current) return
        setPresets(options)
        setPresetStatus('ready')
      },
      (error: unknown) => {
        if (!current) return
        setPresets([])
        setPresetStatus('error')
        setPresetFailure(error instanceof Error ? error.message : String(error))
      },
    )
    return () => { current = false }
  }, [loadAgentPresets, open])

  useEffect(() => {
    if (!open || locationMode !== 'workspace') return
    if (workspaces.some(workspace => String(workspace.workspaceId) === workspaceId)) return
    if (firstWorkspaceId === undefined) {
      setLocationMode('directory')
      setWorkspaceId('')
      return
    }
    setWorkspaceId(String(firstWorkspaceId))
  }, [firstWorkspaceId, locationMode, open, workspaceId, workspaces])

  useEffect(() => () => {
    releaseImages(attachmentsRef.current)
  }, [])

  const close = (): void => {
    if (busy || pickingDirectory) return
    clearFields()
    onClose()
  }

  const chooseDirectory = async (): Promise<void> => {
    setPickingDirectory(true)
    setFailure(null)
    try {
      const path = await pickDirectory()
      if (path !== null) setCwd(path)
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      setPickingDirectory(false)
    }
  }

  const addAttachments = (event: ChangeEvent<HTMLInputElement>): void => {
    const files = [...(event.currentTarget.files ?? [])]
    event.currentTarget.value = ''
    if (files.length === 0) return
    const next: StagedImage[] = []
    for (const file of files) {
      const mediaType = imageMediaType(file.type)
      if (mediaType === undefined) {
        setFailure(t('create.attachment.unsupported', { name: file.name || t('create.attachment.unnamed') }))
        continue
      }
      const previewUrl = createPreviewUrl(file)
      next.push({
        id: crypto.randomUUID(),
        file,
        mediaType,
        ...(previewUrl === undefined ? {} : { previewUrl }),
      })
    }
    if (next.length === 0) return
    setFailure(null)
    replaceAttachments([...attachmentsRef.current, ...next])
  }

  const removeAttachment = (id: string): void => {
    const removed = attachmentsRef.current.find(image => image.id === id)
    if (removed !== undefined) releaseImages([removed])
    replaceAttachments(attachmentsRef.current.filter(image => image.id !== id))
  }

  const uploadImages = async (): Promise<readonly ImageAttachmentRef[] | undefined> => {
    const uploaded: ImageAttachmentRef[] = []
    for (const image of attachmentsRef.current) {
      let data: string
      try {
        data = bytesToBase64(await readFileBytes(image.file))
      } catch {
        setFailure(t('create.attachment.readFailed', { name: image.file.name }))
        return undefined
      }
      const result = await uploadAttachment({
        mediaType: image.mediaType,
        data,
        ...(image.file.name === '' ? {} : { name: image.file.name }),
      })
      if (!result.ok) {
        setFailure(taskBoardErrorMessage(result.error))
        return undefined
      }
      uploaded.push(result.value)
    }
    return uploaded
  }

  const submit = async (start: boolean): Promise<void> => {
    const trimmedTitle = title.trim()
    const trimmedDescription = description.trim()
    const trimmedAcceptance = acceptanceCriteria.trim()
    const trimmedPreset = agentPreset.trim()
    const trimmedCwd = cwd.trim()
    if (mode === 'manual' && trimmedTitle === '') {
      setFailure(t('create.validation.title'))
      return
    }
    if (trimmedDescription === '' && trimmedAcceptance === '') {
      setFailure(t('create.validation.requirement'))
      return
    }
    /* v8 ignore next 4 -- the enabled Workspace selector synchronizes a current option before user input */
    if (locationMode === 'workspace' && workspaceId === '') {
      setFailure(t('create.validation.workspace'))
      return
    }
    if (locationMode === 'directory' && trimmedCwd === '') {
      setFailure(t('create.validation.cwd'))
      return
    }

    setSubmitting(true)
    setFailure(null)
    try {
      const uploaded = await uploadImages()
      if (uploaded === undefined) return
      const request: TaskBoardCreateRequest = {
        ...(trimmedTitle === '' ? {} : { title: trimmedTitle }),
        description: trimmedDescription,
        acceptanceCriteria: trimmedAcceptance,
        ...(locationMode === 'workspace'
          ? { workspaceId: workspaceId as NonNullable<TaskBoardCreateRequest['workspaceId']> }
          : { cwd: trimmedCwd }),
        ...(trimmedPreset === '' ? {} : { agentPreset: trimmedPreset }),
        ...(uploaded.length === 0 ? {} : { attachments: uploaded }),
        start,
      }
      const result = await create(request)
      if (!result.ok) {
        setFailure(taskBoardErrorMessage(result.error))
        return
      }
      clearFields()
      if (!continueCreating) onClose()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={t('create.title')}
      closeLabel={t('create.close')}
      className={css.dialog as string}
      contentClassName={css.content as string}
      footer={(
        <>
          <label className={css.continue}>
            <input
              type="checkbox"
              checked={continueCreating}
              disabled={busy}
              onChange={(event) => { setContinueCreating(event.currentTarget.checked) }}
            />
            <span>{t('create.continue')}</span>
          </label>
          <Button variant="outline" disabled={busy} onClick={() => { void submit(false) }}>
            {t('create.only')}
          </Button>
          <Button disabled={busy} onClick={() => { void submit(true) }}>
            {t('create.start')}
          </Button>
        </>
      )}
    >
      <div className={css.tabs} role="tablist" aria-label={t('create.mode')}>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'agent'}
          disabled={busy}
          onClick={() => { setMode('agent'); setFailure(null) }}
        >
          {t('create.mode.agent')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'manual'}
          disabled={busy}
          onClick={() => { setMode('manual'); setFailure(null) }}
        >
          {t('create.mode.manual')}
        </button>
      </div>

      <div className={css.form} aria-busy={busy || undefined}>
        <label className={css.field}>
          <span>{t('create.title.field')}{mode === 'agent' ? <small>{t('create.title.optional')}</small> : null}</span>
          <input
            aria-label={t('create.title.field')}
            value={title}
            disabled={busy}
            onChange={(event) => { setTitle(event.currentTarget.value) }}
          />
        </label>

        <div className={css.locationGroup}>
          <span className={css.groupLabel}>{t('create.location')}</span>
          <label>
            <input
              type="radio"
              name="task-location"
              checked={locationMode === 'workspace'}
              disabled={busy || workspaces.length === 0}
              onChange={() => { setLocationMode('workspace') }}
            />
            <span>{t('create.location.workspace')}</span>
          </label>
          <label>
            <input
              type="radio"
              name="task-location"
              checked={locationMode === 'directory'}
              disabled={busy}
              onChange={() => { setLocationMode('directory') }}
            />
            <span>{t('create.location.directory')}</span>
          </label>
        </div>

        {locationMode === 'workspace'
          ? (
            <label className={css.field}>
              <span>{t('create.workspace')}</span>
              <select
                aria-label={t('create.workspace')}
                value={workspaceId}
                disabled={busy}
                onChange={(event) => { setWorkspaceId(event.currentTarget.value) }}
              >
                {workspaces.map(workspace => (
                  <option key={workspace.workspaceId} value={workspace.workspaceId}>{workspace.title} — {workspace.path}</option>
                ))}
              </select>
            </label>
          )
          : (
            <div className={css.field}>
              <span>{t('create.cwd')}</span>
              <div className={css.inputRow}>
                <input
                  aria-label={t('create.cwd')}
                  value={cwd}
                  disabled={busy}
                  placeholder="/path/to/project"
                  onChange={(event) => { setCwd(event.currentTarget.value) }}
                />
                <button
                  type="button"
                  className={css.secondaryButton}
                  disabled={busy || pickingDirectory}
                  onClick={() => { void chooseDirectory() }}
                >
                  {pickingDirectory ? t('create.cwd.picking') : t('create.cwd.pick')}
                </button>
              </div>
            </div>
          )}

        <label className={css.field}>
          <span>{t('create.agentPreset')}</span>
          <select
            aria-label={t('create.agentPreset')}
            value={agentPreset}
            disabled={busy || presetStatus === 'loading'}
            onChange={(event) => { setAgentPreset(event.currentTarget.value) }}
          >
            <option value="">
              {presetStatus === 'loading'
                ? t('create.agentPreset.loading')
                : defaultPreset === undefined
                  ? t('create.agentPreset.default')
                  : t('create.agentPreset.defaultNamed', { name: defaultPreset.name ?? defaultPreset.id })}
            </option>
            {presets.map(preset => (
              <option key={preset.id} value={preset.id}>
                {preset.name === undefined ? preset.id : `${preset.name} — ${preset.id}`}
              </option>
            ))}
          </select>
          {presetFailure === null ? null : <small className={css.fieldHint}>{presetFailure}</small>}
        </label>

        <label className={css.field}>
          <span>{t('create.description')}</span>
          <textarea
            aria-label={t('create.description')}
            value={description}
            rows={5}
            autoFocus
            disabled={busy}
            onChange={(event) => { setDescription(event.currentTarget.value) }}
          />
        </label>

        <label className={css.field}>
          <span>{t('create.acceptance')}</span>
          <textarea
            aria-label={t('create.acceptance')}
            value={acceptanceCriteria}
            rows={3}
            disabled={busy}
            onChange={(event) => { setAcceptanceCriteria(event.currentTarget.value) }}
          />
        </label>

        <div className={css.attachments}>
          <div className={css.attachmentHeading}>
            <span>{t('create.attachments')}</span>
            <small>{t('create.attachments.hint')}</small>
          </div>
          <label className={css.attachmentPicker} data-disabled={busy || undefined}>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              disabled={busy}
              aria-label={t('create.attachment.add')}
              onChange={addAttachments}
            />
            <span>{t('create.attachment.add')}</span>
          </label>
          {attachments.length === 0
            ? null
            : (
              <ul className={css.attachmentList}>
                {attachments.map(image => (
                  <li key={image.id} className={css.attachmentItem}>
                    {image.previewUrl === undefined
                      ? <span className={css.imageFallback}>IMG</span>
                      : <img src={image.previewUrl} alt="" />}
                    <span className={css.attachmentName}>{image.file.name || t('create.attachment.unnamed')}</span>
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={t('create.attachment.remove', { name: image.file.name || t('create.attachment.unnamed') })}
                      onClick={() => { removeAttachment(image.id) }}
                    >
                      {t('create.attachment.remove.button')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
        </div>

        {failure === null ? null : <div className={css.failure} role="alert">{failure}</div>}
      </div>
    </Modal>
  )
}
