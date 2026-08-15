/** Persistent task detail with workflow-specific actions. */

import { useEffect, useState } from 'react'
import {
  Button,
  Modal,
  RiskConfirmation,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceView } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  TaskBoardEditPatch,
  TaskBoardRound,
  TaskBoardTask,
  TaskBoardTaskId,
} from '../types.ts'
import { taskBoardErrorMessage, type TaskBoardClientResult } from './controller.ts'
import type { TaskBoardOverlayProps } from './slots.ts'
import css from './TaskDetail.module.css'

interface TaskDetailProps {
  readonly task: TaskBoardTask | undefined
  readonly pending: boolean
  readonly covered: boolean
  readonly workspaces: readonly WorkspaceView[]
  readonly t: TaskBoardOverlayProps['t']
  readonly onClose: () => void
  readonly start: (id: TaskBoardTaskId) => Promise<TaskBoardClientResult<TaskBoardTask>>
  readonly edit: (id: TaskBoardTaskId, patch: TaskBoardEditPatch) => Promise<TaskBoardClientResult<TaskBoardTask>>
  readonly followup: (id: TaskBoardTaskId, text: string) => Promise<TaskBoardClientResult<TaskBoardTask>>
  readonly approve: (id: TaskBoardTaskId) => Promise<TaskBoardClientResult<TaskBoardTask>>
  readonly reject: (id: TaskBoardTaskId, feedback: string) => Promise<TaskBoardClientResult<TaskBoardTask>>
  readonly retry: (id: TaskBoardTaskId, allowFresh: boolean) => Promise<TaskBoardClientResult<TaskBoardTask>>
  readonly stop: (id: TaskBoardTaskId) => Promise<TaskBoardClientResult<TaskBoardTask>>
  readonly reopen: (id: TaskBoardTaskId) => Promise<TaskBoardClientResult<TaskBoardTask>>
  readonly remove: TaskBoardOverlayProps['delete']
  readonly onOpenRound: (roundId: TaskBoardRound['id']) => void
  readonly openSession: TaskBoardOverlayProps['openSession']
}

/**
 * Render the selected card as a document with a right-side property rail.
 * @param props - selected card and Host workflow actions.
 * @returns controlled task detail modal.
 */
export function TaskDetail({
  task,
  pending,
  covered,
  workspaces,
  t,
  onClose,
  start,
  edit,
  followup,
  approve,
  reject,
  retry,
  stop,
  reopen,
  remove,
  onOpenRound,
  openSession,
}: TaskDetailProps) {
  const [feedback, setFeedback] = useState('')
  const [followupText, setFollowupText] = useState('')
  const [failure, setFailure] = useState<string | null>(null)
  const [freshSessionOpen, setFreshSessionOpen] = useState(false)
  const [freshSessionAcknowledged, setFreshSessionAcknowledged] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteAcknowledged, setDeleteAcknowledged] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editTitle, setEditTitle] = useState(task?.title ?? '')
  const [editDescription, setEditDescription] = useState(task?.description ?? '')
  const [editAcceptance, setEditAcceptance] = useState(task?.acceptanceCriteria ?? '')
  const nestedDialogOpen = covered || freshSessionOpen || deleteOpen || editOpen

  useEffect(() => {
    setFeedback('')
    setFollowupText('')
    setFailure(null)
    setFreshSessionOpen(false)
    setFreshSessionAcknowledged(false)
    setDeleteOpen(false)
    setDeleteAcknowledged(false)
    setEditOpen(false)
    setEditTitle(task?.title ?? '')
    setEditDescription(task?.description ?? '')
    setEditAcceptance(task?.acceptanceCriteria ?? '')
  }, [task?.id])

  if (task === undefined) return null
  const latestFailure = task.rounds.at(-1)?.failure ?? task.lastStartFailure
  const workspace = task.workspaceId === undefined
    ? undefined
    : workspaces.find(item => item.workspaceId === task.workspaceId)

  const run = async (operation: Promise<TaskBoardClientResult<TaskBoardTask>>): Promise<boolean> => {
    setFailure(null)
    const result = await operation
    if (result.ok) return true
    setFailure(taskBoardErrorMessage(result.error))
    return false
  }

  const retryTask = async (): Promise<void> => {
    setFailure(null)
    const result = await retry(task.id, false)
    if (result.ok) return
    if (result.error.code === 'fresh-session-required') {
      setFreshSessionOpen(true)
      return
    }
    setFailure(taskBoardErrorMessage(result.error))
  }

  const retryFresh = async (): Promise<void> => {
    const result = await retry(task.id, true)
    if (result.ok) {
      setFreshSessionOpen(false)
      setFreshSessionAcknowledged(false)
      return
    }
    setFailure(taskBoardErrorMessage(result.error))
  }

  const deleteTask = async (): Promise<void> => {
    const result = await remove(task.id)
    if (result.ok) {
      setDeleteOpen(false)
      onClose()
      return
    }
    setFailure(taskBoardErrorMessage(result.error))
  }

  const saveEdit = async (): Promise<void> => {
    const patch: TaskBoardEditPatch = {
      title: editTitle.trim(),
      description: editDescription.trim(),
      acceptanceCriteria: editAcceptance.trim(),
    }
    const result = await edit(task.id, patch)
    if (result.ok) {
      setEditOpen(false)
      return
    }
    setFailure(taskBoardErrorMessage(result.error))
  }

  return (
    <Modal
      open
      onClose={() => { if (!nestedDialogOpen) onClose() }}
      title={`${task.identifier} ${task.title}`}
      closeLabel={t('detail.close')}
      className={css.dialog as string}
      contentClassName={css.content as string}
    >
      <div className={css.layout}>
        <main className={css.document}>
          {task.status !== 'running'
            ? <Button variant="outline" size="sm" onClick={() => { setEditOpen(true) }}>{t('detail.edit')}</Button>
            : null}
          <section>
            <h3>{t('detail.requirement')}</h3>
            <p>{task.description || '—'}</p>
          </section>
          <section>
            <h3>{t('detail.acceptance')}</h3>
            <p>{task.acceptanceCriteria || '—'}</p>
          </section>

          {task.status === 'running'
            ? (
              <section className={css.actionPanel}>
                <h3>{t('detail.followup')}</h3>
                <textarea aria-label={t('detail.followup')} rows={3} value={followupText} onChange={(event) => { setFollowupText(event.currentTarget.value) }} />
                <div className={css.actionRow}>
                  <Button
                    variant="primary"
                    disabled={pending || followupText.trim() === ''}
                    onClick={() => {
                      void run(followup(task.id, followupText.trim())).then((ok) => { if (ok) setFollowupText('') })
                    }}
                  >{t('detail.followup.send')}</Button>
                  <Button variant="outline" disabled={pending} onClick={() => { void run(stop(task.id)) }}>{t('detail.stop')}</Button>
                </div>
              </section>
            )
            : null}

          {task.status === 'review'
            ? (
              <section className={css.reviewPanel}>
                <h3>{t('detail.review')}</h3>
                <div className={css.actionRow}>
                  <Button variant="primary" disabled={pending} onClick={() => { void run(approve(task.id)) }}>{t('detail.approve')}</Button>
                </div>
                <label>
                  <span>{t('detail.reject.feedback')}</span>
                  <textarea aria-label={t('detail.reject.feedback')} rows={3} value={feedback} onChange={(event) => { setFeedback(event.currentTarget.value) }} />
                </label>
                <Button
                  variant="outline"
                  disabled={pending || feedback.trim() === ''}
                  onClick={() => { void run(reject(task.id, feedback.trim())) }}
                >{t('detail.reject')}</Button>
              </section>
            )
            : null}

          {task.status === 'failed'
            ? (
              <section className={css.failurePanel}>
                <h3>{t('detail.failure')}</h3>
                <strong>{latestFailure?.code ?? t('card.failed')}</strong>
                <p>{latestFailure?.message ?? t('detail.failure.unknown')}</p>
                <Button variant="primary" disabled={pending} onClick={() => { void retryTask() }}>{t('detail.retry')}</Button>
              </section>
            )
            : null}

          {task.status === 'initialized'
            ? <Button variant="primary" disabled={pending} onClick={() => { void run(start(task.id)) }}>{t('detail.start')}</Button>
            : null}
          {task.status === 'done'
            ? <Button variant="outline" disabled={pending} onClick={() => { void run(reopen(task.id)) }}>{t('detail.reopen')}</Button>
            : null}

          {task.status !== 'running'
            ? <Button variant="ghost" disabled={pending} onClick={() => { setDeleteOpen(true) }}>{t('detail.delete')}</Button>
            : null}

          {failure === null ? null : <div className={css.inlineFailure} role="alert">{failure}</div>}

          <section>
            <h3>{t('detail.activity')}</h3>
            <ol className={css.timeline}>
              {[...task.activity].reverse().map(activity => (
                <li key={activity.id}>
                  <span>{new Date(activity.at).toLocaleString()}</span>
                  <strong>{t(`activity.${activity.operation}`)}</strong>
                </li>
              ))}
              {task.activity.length === 0 ? <li>{t('detail.activity.empty')}</li> : null}
            </ol>
          </section>
        </main>

        <aside className={css.rail}>
          <dl>
            <div><dt>{t('detail.status')}</dt><dd>{t(`status.${task.status}`)}</dd></div>
            <div><dt>{t('detail.agent')}</dt><dd>{task.agentPreset ?? '—'}</dd></div>
            <div><dt>{t('detail.location')}</dt><dd>{workspace?.title ?? task.cwd ?? '—'}</dd></div>
            <div><dt>{t('detail.rounds')}</dt><dd>{task.rounds.length}</dd></div>
            <div><dt>{t('detail.created')}</dt><dd>{new Date(task.createdAt).toLocaleString()}</dd></div>
            <div><dt>{t('detail.updated')}</dt><dd>{new Date(task.updatedAt).toLocaleString()}</dd></div>
          </dl>
          <section>
            <h3>{t('detail.sessions')}</h3>
            {task.rounds.map(round => (
              <div key={round.id} className={css.roundGroup}>
                <button
                  type="button"
                  className={css.round}
                  aria-label={t('log.open', { ordinal: round.ordinal })}
                  onClick={() => { onOpenRound(round.id) }}
                >
                  <span>#{round.ordinal} · {round.trigger}</span>
                  <strong>{round.status}</strong>
                </button>
                <button
                  type="button"
                  className={css.sessionLink}
                  onClick={() => { onClose(); openSession(round.sessionId) }}
                >{round.sessionId}</button>
              </div>
            ))}
            {task.rounds.length === 0 ? <p>—</p> : null}
          </section>
        </aside>
      </div>
      <RiskConfirmation
        open={freshSessionOpen}
        title={t('detail.retry.fresh.title')}
        description={t('detail.retry.fresh.description')}
        acknowledgeLabel={t('detail.retry.fresh.acknowledge')}
        cancelLabel={t('detail.cancel')}
        confirmLabel={t('detail.retry.fresh.confirm')}
        acknowledged={freshSessionAcknowledged}
        disabled={pending}
        onAcknowledgedChange={setFreshSessionAcknowledged}
        onCancel={() => { setFreshSessionOpen(false); setFreshSessionAcknowledged(false) }}
        onConfirm={() => { void retryFresh() }}
      />
      <RiskConfirmation
        open={deleteOpen}
        title={t('detail.delete.title')}
        description={t('detail.delete.description')}
        acknowledgeLabel={t('detail.delete.acknowledge')}
        cancelLabel={t('detail.cancel')}
        confirmLabel={t('detail.delete.confirm')}
        acknowledged={deleteAcknowledged}
        disabled={pending}
        onAcknowledgedChange={setDeleteAcknowledged}
        onCancel={() => { setDeleteOpen(false); setDeleteAcknowledged(false) }}
        onConfirm={() => { void deleteTask() }}
      />
      <Modal
        open={editOpen}
        onClose={() => { setEditOpen(false) }}
        title={t('detail.edit.title', { identifier: task.identifier })}
        closeLabel={t('detail.cancel')}
        className={css.editDialog as string}
        footer={(
          <>
            <Button variant="outline" onClick={() => { setEditOpen(false) }}>{t('detail.cancel')}</Button>
            <Button variant="primary" disabled={pending || editTitle.trim() === ''} onClick={() => { void saveEdit() }}>{t('detail.edit.save')}</Button>
          </>
        )}
      >
        <div className={css.editForm}>
          <label><span>{t('create.title.field')}</span><input aria-label={t('create.title.field')} value={editTitle} onChange={(event) => { setEditTitle(event.currentTarget.value) }} /></label>
          <label><span>{t('create.description')}</span><textarea aria-label={t('create.description')} rows={5} value={editDescription} onChange={(event) => { setEditDescription(event.currentTarget.value) }} /></label>
          <label><span>{t('create.acceptance')}</span><textarea aria-label={t('create.acceptance')} rows={4} value={editAcceptance} onChange={(event) => { setEditAcceptance(event.currentTarget.value) }} /></label>
        </div>
      </Modal>
    </Modal>
  )
}
