/** Multica-style five-column task-board and compact list view. */

import { useMemo, useState } from 'react'
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import clsx from 'clsx'
import {
  IconAgentPresetOutline16,
  IconChecklistOutline14,
  IconPlusOutline16,
  IconSearchOutline16,
  Input,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceView } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  TaskBoardStatus,
  TaskBoardTask,
  TaskBoardTaskId,
} from '../types.ts'
import {
  resolveTaskDrop,
  TASK_BOARD_COLUMN_PREFIX,
} from './drag.ts'
import type {
  TaskBoardDisplayKey,
  TaskBoardDisplayOptions,
  TaskBoardViewMode,
} from './store.ts'
import type { TaskBoardOverlayProps } from './slots.ts'
import css from './TaskBoardView.module.css'

/** Fixed domain state order rendered in board and filters. */
export const TASK_BOARD_STATUSES: readonly TaskBoardStatus[] = [
  'initialized',
  'running',
  'review',
  'done',
  'failed',
]

interface TaskBoardViewProps {
  readonly tasks: readonly TaskBoardTask[]
  readonly pendingTaskIds: readonly TaskBoardTaskId[]
  readonly workspaces: readonly WorkspaceView[]
  readonly query: string
  readonly statusFilter: TaskBoardStatus | 'all'
  readonly locationFilter: string
  readonly agentPresetFilter: string
  readonly viewMode: TaskBoardViewMode
  readonly display: TaskBoardDisplayOptions
  readonly t: TaskBoardOverlayProps['t']
  readonly onQueryChange: (query: string) => void
  readonly onStatusFilterChange: (status: TaskBoardStatus | 'all') => void
  readonly onLocationFilterChange: (location: string) => void
  readonly onAgentPresetFilterChange: (agentPreset: string) => void
  readonly onViewModeChange: (mode: TaskBoardViewMode) => void
  readonly onToggleDisplay: (key: TaskBoardDisplayKey) => void
  readonly onCreate: (status?: TaskBoardStatus) => void
  readonly onOpenTask: (taskId: TaskBoardTaskId) => void
  readonly onReorder: (taskId: TaskBoardTaskId, beforeTaskId?: TaskBoardTaskId) => void | Promise<unknown>
}

interface TaskCardProps {
  readonly task: TaskBoardTask
  readonly pending: boolean
  readonly display: TaskBoardDisplayOptions
  readonly workspaces: readonly WorkspaceView[]
  readonly t: TaskBoardOverlayProps['t']
  readonly overlay?: boolean
  readonly onOpen: () => void
}

function statusLabel(status: TaskBoardStatus, t: TaskBoardOverlayProps['t']): string {
  return t(`status.${status}`)
}

function failureMessage(task: TaskBoardTask): string | undefined {
  return task.rounds.at(-1)?.failure?.message ?? task.lastStartFailure?.message
}

function workspaceLabel(
  workspaceId: NonNullable<TaskBoardTask['workspaceId']>,
  workspaces: readonly WorkspaceView[],
): string {
  return workspaces.find(workspace => workspace.workspaceId === workspaceId)?.title
    ?? String(workspaceId)
}

function locationLabel(task: TaskBoardTask, workspaces: readonly WorkspaceView[]): string | undefined {
  if (task.workspaceId !== undefined) {
    return workspaceLabel(task.workspaceId, workspaces)
  }
  return task.cwd
}

function matches(task: TaskBoardTask, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase()
  if (normalized === '') return true
  return [task.identifier, task.title, task.description, task.acceptanceCriteria]
    .some(value => value.toLocaleLowerCase().includes(normalized))
}

function TaskCard({
  task,
  pending,
  display,
  workspaces,
  t,
  overlay = false,
  onOpen,
}: TaskCardProps) {
  const sortable = useSortable({ id: task.id, disabled: overlay || pending })
  const style = overlay
    ? undefined
    : {
      transform: CSS.Transform.toString(sortable.transform),
      transition: sortable.transition,
    }
  const location = locationLabel(task, workspaces)
  const failure = failureMessage(task)
  const running = task.status === 'running'
  const starting = task.rounds.at(-1)?.status === 'starting'

  return (
    <article
      ref={overlay ? undefined : sortable.setNodeRef}
      style={style}
      className={clsx(css.card, overlay && css.cardOverlay, pending && css.cardPending)}
      data-status={task.status}
    >
      {overlay
        ? null
        : (
          <button
            type="button"
            className={css.dragHandle}
            aria-label={t('card.drag', { identifier: task.identifier })}
            {...sortable.attributes}
            {...sortable.listeners}
          >
            <span />
            <span />
            <span />
          </button>
        )}
      <button type="button" className={css.cardButton} aria-label={`${task.identifier} ${task.title}`} onClick={onOpen}>
        <span className={css.identifier}>{task.identifier}</span>
        {running
          ? (
            <span className={css.liveBadge}>
              <span className={css.liveDot} />
              {t(starting ? 'card.starting' : 'card.running')}
            </span>
          )
          : null}
        <strong className={css.cardTitle}>{task.title}</strong>
        {display.description && task.description !== ''
          ? <span className={css.description}>{task.description}</span>
          : null}
        {task.status === 'failed' && failure !== undefined
          ? <span className={css.failure}>{failure}</span>
          : null}
        <span className={css.meta}>
          {display.agentPreset && task.agentPreset !== undefined
            ? (
              <span className={css.metaItem}>
                <IconAgentPresetOutline16 size={12} />
                {task.agentPreset}
              </span>
            )
            : null}
          {display.location && location !== undefined
            ? <span className={css.location} title={location}>{location}</span>
            : null}
          {display.rounds ? <span>{t('card.rounds', { count: task.rounds.length })}</span> : null}
          {display.updatedAt ? <span className={css.updated}>{t('card.updated')}</span> : null}
        </span>
      </button>
    </article>
  )
}

function BoardColumn({
  status,
  tasks,
  pendingTaskIds,
  display,
  workspaces,
  t,
  onCreate,
  onOpenTask,
}: {
  readonly status: TaskBoardStatus
  readonly tasks: readonly TaskBoardTask[]
  readonly pendingTaskIds: readonly TaskBoardTaskId[]
  readonly display: TaskBoardDisplayOptions
  readonly workspaces: readonly WorkspaceView[]
  readonly t: TaskBoardOverlayProps['t']
  readonly onCreate: () => void
  readonly onOpenTask: (taskId: TaskBoardTaskId) => void
}) {
  const columnId = `${TASK_BOARD_COLUMN_PREFIX}${status}`
  const drop = useDroppable({ id: columnId })
  return (
    <section ref={drop.setNodeRef} className={css.column} data-status={status} data-over={drop.isOver || undefined}>
      <header className={css.columnHeader}>
        <span className={css.statusDot} />
        <h2>{statusLabel(status, t)}</h2>
        <span className={css.count}>{tasks.length}</span>
        <button type="button" className={css.columnAdd} aria-label={`${t('column.create')} ${statusLabel(status, t)}`} onClick={onCreate}>
          <IconPlusOutline16 />
        </button>
      </header>
      <SortableContext items={tasks.map(task => task.id)} strategy={verticalListSortingStrategy}>
        <div className={css.cards}>
          {tasks.map(task => (
            <TaskCard
              key={task.id}
              task={task}
              pending={pendingTaskIds.includes(task.id)}
              display={display}
              workspaces={workspaces}
              t={t}
              onOpen={() => { onOpenTask(task.id) }}
            />
          ))}
          {tasks.length === 0
            ? (
              <button type="button" className={css.emptyColumn} onClick={onCreate}>
                <IconPlusOutline16 />
                {t('column.empty')}
              </button>
            )
            : null}
        </div>
      </SortableContext>
    </section>
  )
}

const DISPLAY_KEYS: readonly [TaskBoardDisplayKey, string][] = [
  ['description', '描述'],
  ['agentPreset', 'Agent Preset'],
  ['location', 'Workspace / 目录'],
  ['rounds', '执行轮次'],
  ['updatedAt', '更新时间'],
]

/**
 * Render the task collection with one toolbar and board/list presentations.
 * @param props - authoritative tasks and presentation actions.
 * @returns toolbar plus selected task collection view.
 */
export function TaskBoardView({
  tasks,
  pendingTaskIds,
  workspaces,
  query,
  statusFilter,
  locationFilter,
  agentPresetFilter,
  viewMode,
  display,
  t,
  onQueryChange,
  onStatusFilterChange,
  onLocationFilterChange,
  onAgentPresetFilterChange,
  onViewModeChange,
  onToggleDisplay,
  onCreate,
  onOpenTask,
  onReorder,
}: TaskBoardViewProps) {
  const [displayOpen, setDisplayOpen] = useState(false)
  const [activeTaskId, setActiveTaskId] = useState<TaskBoardTaskId | null>(null)
  const [dragFeedback, setDragFeedback] = useState<string | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const locationOptions = useMemo(() => [...new Map(tasks.flatMap((task) => {
    if (task.workspaceId !== undefined) {
      const value = `workspace:${task.workspaceId}`
      return [[value, workspaceLabel(task.workspaceId, workspaces)] as const]
    }
    if (task.cwd !== undefined) return [[`cwd:${task.cwd}`, task.cwd] as const]
    return []
  })).entries()], [tasks, workspaces])
  const agentOptions = useMemo(
    () => [...new Set(tasks.flatMap(task => task.agentPreset === undefined ? [] : [task.agentPreset]))].sort(),
    [tasks],
  )
  const filtered = useMemo(() => tasks.filter((task) => {
    const taskLocation = task.workspaceId !== undefined
      ? `workspace:${task.workspaceId}`
      : task.cwd === undefined ? 'none' : `cwd:${task.cwd}`
    return (statusFilter === 'all' || task.status === statusFilter)
      && (locationFilter === 'all' || taskLocation === locationFilter)
      && (agentPresetFilter === 'all' || task.agentPreset === agentPresetFilter)
      && matches(task, query)
  }), [agentPresetFilter, locationFilter, query, statusFilter, tasks])
  const activeTask = activeTaskId === null ? undefined : tasks.find(task => task.id === activeTaskId)

  const handleDragStart = (event: DragStartEvent): void => {
    setDragFeedback(null)
    setActiveTaskId(event.active.id as TaskBoardTaskId)
  }
  const handleDragEnd = (event: DragEndEvent): void => {
    setActiveTaskId(null)
    if (event.over === null) return
    const resolution = resolveTaskDrop(tasks, event.active.id as TaskBoardTaskId, String(event.over.id))
    if (resolution.kind === 'forbidden') {
      setDragFeedback(t('drag.forbidden'))
      return
    }
    if (resolution.kind === 'reorder') void onReorder(event.active.id as TaskBoardTaskId, resolution.beforeTaskId)
  }

  return (
    <div className={css.root}>
      <div className={css.toolbar}>
        <button type="button" className={css.primaryAction} onClick={() => { onCreate() }}>
          <IconPlusOutline16 />
          {t('board.new')}
        </button>
        <Input
          type="search"
          role="searchbox"
          aria-label={t('board.search.aria')}
          placeholder={t('board.search')}
          value={query}
          icon={<IconSearchOutline16 />}
          data-task-board-search
          className={css.search as string}
          onChange={(event) => { onQueryChange(event.currentTarget.value) }}
        />
        <select
          className={css.select}
          aria-label={t('filter.status')}
          value={statusFilter}
          onChange={(event) => { onStatusFilterChange(event.currentTarget.value as TaskBoardStatus | 'all') }}
        >
          <option value="all">{t('status.all')}</option>
          {TASK_BOARD_STATUSES.map(status => (
            <option key={status} value={status}>{statusLabel(status, t)}</option>
          ))}
        </select>
        <select
          className={css.select}
          aria-label={t('filter.location')}
          value={locationFilter}
          onChange={(event) => { onLocationFilterChange(event.currentTarget.value) }}
        >
          <option value="all">{t('filter.location.all')}</option>
          {locationOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select
          className={css.select}
          aria-label={t('filter.agent')}
          value={agentPresetFilter}
          onChange={(event) => { onAgentPresetFilterChange(event.currentTarget.value) }}
        >
          <option value="all">{t('filter.agent.all')}</option>
          {agentOptions.map(agentPreset => <option key={agentPreset} value={agentPreset}>{agentPreset}</option>)}
        </select>
        <div className={css.displayControl}>
          <button type="button" className={css.toolbarButton} aria-expanded={displayOpen} onClick={() => { setDisplayOpen(open => !open) }}>
            {t('display.button')}
          </button>
          {displayOpen
            ? (
              <div className={css.displayMenu}>
                {DISPLAY_KEYS.map(([key, label]) => (
                  <label key={key}>
                    <input type="checkbox" checked={display[key]} onChange={() => { onToggleDisplay(key) }} />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            )
            : null}
        </div>
        <div className={css.viewSwitch} aria-label={t('view.switch')}>
          <button type="button" aria-pressed={viewMode === 'board'} onClick={() => { onViewModeChange('board') }}>
            <IconChecklistOutline14 />
            {t('board.view.board')}
          </button>
          <button type="button" aria-pressed={viewMode === 'list'} onClick={() => { onViewModeChange('list') }}>
            {t('board.view.list')}
          </button>
        </div>
      </div>

      {dragFeedback !== null ? <div className={css.dragFeedback} role="status">{dragFeedback}</div> : null}

      {viewMode === 'board'
        ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragCancel={() => { setActiveTaskId(null) }}
            onDragEnd={handleDragEnd}
          >
            <div className={css.board}>
              {TASK_BOARD_STATUSES.map(status => (
                <BoardColumn
                  key={status}
                  status={status}
                  tasks={filtered.filter(task => task.status === status)}
                  pendingTaskIds={pendingTaskIds}
                  display={display}
                  workspaces={workspaces}
                  t={t}
                  onCreate={() => { onCreate(status) }}
                  onOpenTask={onOpenTask}
                />
              ))}
            </div>
            <DragOverlay>
              {activeTask === undefined
                ? null
                : (
                  <TaskCard
                    task={activeTask}
                    pending={false}
                    display={display}
                    workspaces={workspaces}
                    t={t}
                    overlay
                    onOpen={() => {}}
                  />
                )}
            </DragOverlay>
          </DndContext>
        )
        : (
          <div className={css.tableWrap}>
            <table className={css.table} aria-label={t('list.aria')}>
              <thead>
                <tr>
                  <th>{t('list.task')}</th>
                  <th>{t('list.status')}</th>
                  <th>{t('list.agent')}</th>
                  <th>{t('list.location')}</th>
                  <th>{t('list.rounds')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(task => (
                  <tr key={task.id}>
                    <td>
                      <button type="button" className={css.listTask} onClick={() => { onOpenTask(task.id) }}>
                        <span>{task.identifier}</span>
                        <strong>{task.title}</strong>
                        {display.description ? <small>{task.description}</small> : null}
                      </button>
                    </td>
                    <td><span className={css.listStatus} data-status={task.status}>{statusLabel(task.status, t)}</span></td>
                    <td>{task.agentPreset ?? '—'}</td>
                    <td>{locationLabel(task, workspaces) ?? '—'}</td>
                    <td>{task.rounds.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  )
}
