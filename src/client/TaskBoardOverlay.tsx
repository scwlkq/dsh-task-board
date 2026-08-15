/** Full-frame task-board overlay shell. */

import { useEffect } from 'react'
import {
  IconCloseOutline16,
  IconRefreshOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { CreateTaskDialog } from './CreateTaskDialog.tsx'
import { taskBoardErrorMessage } from './controller.ts'
import { TaskBoardView } from './TaskBoardView.tsx'
import { TaskDetail } from './TaskDetail.tsx'
import { ExecutionLogDialog } from './ExecutionLogDialog.tsx'
import type { TaskBoardOverlayProps } from './slots.ts'
import css from './TaskBoardOverlay.module.css'

/**
 * Render the root task-board surface while its shared store is open.
 * @param props - slot runtime, shared store, and Host-backed task projection.
 * @returns full-frame overlay or null while closed.
 */
export function TaskBoardOverlay({
  useStore,
  actions,
  useBoard,
  refresh,
  loadAgentPresets,
  pickDirectory,
  uploadAttachment,
  create,
  edit,
  reorder,
  start,
  followup,
  approve,
  reject,
  retry,
  stop,
  reopen,
  delete: deleteTask,
  openSession,
  loadRoundHistory,
  useWorkspaces,
  t,
}: TaskBoardOverlayProps) {
  const open = useStore(state => state.open)
  const createOpen = useStore(state => state.createOpen)
  const selectedTaskId = useStore(state => state.selectedTaskId)
  const selectedRoundId = useStore(state => state.selectedRoundId)
  const query = useStore(state => state.query)
  const statusFilter = useStore(state => state.statusFilter)
  const locationFilter = useStore(state => state.locationFilter)
  const agentPresetFilter = useStore(state => state.agentPresetFilter)
  const viewMode = useStore(state => state.viewMode)
  const display = useStore(state => state.display)
  const status = useBoard(view => view.status)
  const tasks = useBoard(view => view.tasks)
  const pendingTaskIds = useBoard(view => view.pendingTaskIds)
  const creating = useBoard(view => view.creating)
  const error = useBoard(view => view.error)
  const workspaces = useWorkspaces(state => state.items)
  const selectedTask = selectedTaskId === null
    ? undefined
    : tasks.find(task => task.id === selectedTaskId)
  const selectedRound = selectedRoundId === null
    ? undefined
    : selectedTask?.rounds.find(round => round.id === selectedRoundId)

  useEffect(() => {
    if (open && (status === 'cold' || status === 'error')) void refresh()
  }, [open, refresh, status])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target
      const editing = target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || target instanceof HTMLSelectElement
        || (target instanceof HTMLElement && target.isContentEditable)
      if (event.key === 'Escape' && !createOpen && selectedTaskId === null && selectedRoundId === null) {
        event.preventDefault()
        actions.close()
      } else if (event.key === '/' && !editing && !createOpen && selectedTaskId === null) {
        event.preventDefault()
        document.querySelector<HTMLInputElement>('[data-task-board-search]')?.focus()
      } else if (event.key.toLocaleLowerCase() === 'c' && !editing && !createOpen && selectedTaskId === null) {
        event.preventDefault()
        actions.openCreate()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [actions, createOpen, open, selectedRoundId, selectedTaskId])

  if (!open) return null

  return (
    <section className={css.root} aria-label={t('board.title')}>
      <header className={css.header}>
        <div>
          <h1 className={css.title}>{t('board.title')}</h1>
          <p className={css.subtitle}>{t('board.subtitle')}</p>
        </div>
        <div className={css.actions}>
          <button type="button" className={css.iconButton} aria-label={t('board.refresh')} onClick={() => { void refresh() }}>
            <IconRefreshOutline16 />
          </button>
          <button type="button" className={css.iconButton} aria-label={t('board.close')} onClick={() => { actions.close() }}>
            <IconCloseOutline16 />
          </button>
        </div>
      </header>
      <div className={css.body}>
        {status === 'loading' || status === 'cold'
          ? <p className={css.message}>{t('board.loading')}</p>
          : status === 'error'
            ? (
              <div className={css.error} role="alert">
                <strong>{t('board.error')}</strong>
                <span>{error === null ? '' : taskBoardErrorMessage(error)}</span>
                <button type="button" onClick={() => { void refresh() }}>{t('board.refresh')}</button>
              </div>
            )
            : (
              <TaskBoardView
                tasks={tasks}
                pendingTaskIds={pendingTaskIds}
                workspaces={workspaces}
                query={query}
                statusFilter={statusFilter}
                locationFilter={locationFilter}
                agentPresetFilter={agentPresetFilter}
                viewMode={viewMode}
                display={display}
                t={t}
                onQueryChange={actions.setQuery}
                onStatusFilterChange={actions.setStatusFilter}
                onLocationFilterChange={actions.setLocationFilter}
                onAgentPresetFilterChange={actions.setAgentPresetFilter}
                onViewModeChange={actions.setViewMode}
                onToggleDisplay={actions.toggleDisplay}
                onCreate={actions.openCreate}
                onOpenTask={(taskId) => { actions.selectTask(taskId) }}
                onReorder={reorder}
              />
            )}
      </div>
      <CreateTaskDialog
        open={createOpen}
        creating={creating}
        workspaces={workspaces}
        t={t}
        loadAgentPresets={loadAgentPresets}
        pickDirectory={pickDirectory}
        uploadAttachment={uploadAttachment}
        create={create}
        onClose={() => { actions.closeCreate() }}
      />
      <TaskDetail
        task={selectedTask}
        pending={selectedTaskId !== null && pendingTaskIds.includes(selectedTaskId)}
        covered={selectedRound !== undefined}
        workspaces={workspaces}
        t={t}
        onClose={() => { actions.selectTask(null) }}
        start={start}
        edit={edit}
        followup={followup}
        approve={approve}
        reject={reject}
        retry={retry}
        stop={stop}
        reopen={reopen}
        remove={deleteTask}
        onOpenRound={(roundId) => { actions.selectRound(roundId) }}
        openSession={openSession}
      />
      {selectedTask !== undefined && selectedRound !== undefined
        ? (
          <ExecutionLogDialog
            task={selectedTask}
            round={selectedRound}
            t={t}
            load={loadRoundHistory}
            stop={stop}
            onClose={() => { actions.selectRound(null) }}
          />
        )
        : null}
    </section>
  )
}
