// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { WorkspaceView } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  TaskBoardRound,
  TaskBoardStatus,
  TaskBoardTask,
  TaskBoardTaskId,
} from '../src/types.ts'
import { zh } from '../src/client/locales.ts'
import { TaskBoardView } from '../src/client/TaskBoardView.tsx'

const dndState = vi.hoisted(() => ({
  contextProps: undefined as unknown,
  overId: undefined as string | undefined,
  sortable: [] as Array<{ readonly id: string; readonly disabled: boolean }>,
}))

vi.mock('@dnd-kit/core', () => ({
  closestCenter: () => null,
  DndContext: (props: { readonly children: unknown }) => {
    dndState.contextProps = props
    return props.children
  },
  DragOverlay: (props: { readonly children: unknown }) => props.children,
  KeyboardSensor: 'keyboard-sensor',
  PointerSensor: 'pointer-sensor',
  useDroppable: ({ id }: { readonly id: string }) => ({
    isOver: dndState.overId === id,
    setNodeRef: () => undefined,
  }),
  useSensor: (sensor: unknown, options: unknown) => ({ sensor, options }),
  useSensors: (...sensors: readonly unknown[]) => sensors,
}))

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: (props: { readonly children: unknown }) => props.children,
  sortableKeyboardCoordinates: () => undefined,
  useSortable: ({ id, disabled }: { readonly id: string; readonly disabled: boolean }) => {
    dndState.sortable.push({ id, disabled })
    return {
      attributes: {},
      listeners: {},
      setNodeRef: () => undefined,
      transform: null,
      transition: undefined,
    }
  },
  verticalListSortingStrategy: {},
}))

vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => undefined } },
}))

afterEach(cleanup)
beforeEach(() => {
  dndState.contextProps = undefined
  dndState.overId = undefined
  dndState.sortable = []
})

const t = makeTranslate(zh)

function round(status: TaskBoardRound['status'], failure?: string): TaskBoardRound {
  return {
    id: `round-${status}` as never,
    ordinal: 1,
    trigger: 'initial',
    status,
    originStatus: 'initialized',
    sessionId: `session-${status}` as never,
    prompts: [],
    startedAt: 1,
    ...(failure === undefined
      ? {}
      : {
        endedAt: 2,
        failure: { stage: 'execution' as const, code: 'FAILED', message: failure },
      }),
  }
}

function task(
  id: string,
  status: TaskBoardStatus,
  position: string,
  overrides: Partial<TaskBoardTask> = {},
): TaskBoardTask {
  const sequence = Number(id.replace(/\D/g, '')) || 1
  return {
    id: id as TaskBoardTaskId,
    sequence,
    identifier: `DSH-${sequence}`,
    revision: 1,
    title: `Task ${sequence}`,
    titleMode: 'manual',
    description: `Description ${sequence}`,
    acceptanceCriteria: `Acceptance ${sequence}`,
    status,
    position,
    attachments: [],
    rounds: [],
    activity: [],
    createdAt: sequence,
    updatedAt: sequence,
    ...overrides,
  }
}

const workspaces = [{
  workspaceId: 'workspace-1' as WorkspaceView['workspaceId'],
  title: 'Harness Workspace',
  path: '/repo/harness',
  sessionIds: [],
  createdAt: '2026-08-14T00:00:00.000Z',
  updatedAt: '2026-08-14T00:00:00.000Z',
}] satisfies readonly WorkspaceView[]

const tasks: readonly TaskBoardTask[] = [
  task('task-1', 'initialized', 'a', {
    workspaceId: 'workspace-1' as never,
    agentPreset: 'Backend',
    description: '',
  }),
  task('task-2', 'initialized', 'b', {
    cwd: '/tmp/project',
    agentPreset: 'Frontend',
  }),
  task('task-3', 'running', 'a', {
    rounds: [round('starting')],
  }),
  task('task-4', 'done', 'a', {
    workspaceId: 'workspace-missing' as never,
  }),
  task('task-5', 'failed', 'a', {
    rounds: [round('failed', 'Round failed')],
  }),
  task('task-6', 'failed', 'b'),
]

function props(overrides: Partial<ComponentProps<typeof TaskBoardView>> = {}) {
  return {
    tasks,
    pendingTaskIds: [tasks[2]!.id],
    workspaces,
    query: '',
    statusFilter: 'all' as const,
    locationFilter: 'all',
    agentPresetFilter: 'all',
    viewMode: 'board' as const,
    display: {
      description: true,
      agentPreset: true,
      location: true,
      rounds: true,
      updatedAt: true,
    },
    t,
    onQueryChange: vi.fn(),
    onStatusFilterChange: vi.fn(),
    onLocationFilterChange: vi.fn(),
    onAgentPresetFilterChange: vi.fn(),
    onViewModeChange: vi.fn(),
    onToggleDisplay: vi.fn(),
    onCreate: vi.fn(),
    onOpenTask: vi.fn(),
    onReorder: vi.fn(),
    ...overrides,
  } satisfies ComponentProps<typeof TaskBoardView>
}

describe('TaskBoardView', () => {
  it('renders optional metadata and forwards every toolbar and card action', () => {
    dndState.overId = 'task-board-column:initialized'
    const current = props()
    const view = render(<TaskBoardView {...current} />)

    expect(screen.getAllByText('Harness Workspace')).toHaveLength(2)
    expect(screen.getAllByText('/tmp/project')).toHaveLength(2)
    expect(screen.getAllByText('workspace-missing')).toHaveLength(2)
    expect(screen.getByText('Round failed')).toBeDefined()
    expect(screen.getByText('正在启动')).toBeDefined()
    expect(dndState.sortable).toContainEqual({ id: tasks[2]!.id, disabled: true })

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索任务' }), { target: { value: 'Acceptance 2' } })
    fireEvent.change(screen.getByRole('combobox', { name: '状态' }), { target: { value: 'failed' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Workspace / 目录' }), {
      target: { value: 'cwd:/tmp/project' },
    })
    fireEvent.change(screen.getByRole('combobox', { name: 'Agent Preset' }), { target: { value: 'Frontend' } })
    expect(current.onQueryChange).toHaveBeenCalledWith('Acceptance 2')
    expect(current.onStatusFilterChange).toHaveBeenCalledWith('failed')
    expect(current.onLocationFilterChange).toHaveBeenCalledWith('cwd:/tmp/project')
    expect(current.onAgentPresetFilterChange).toHaveBeenCalledWith('Frontend')

    fireEvent.click(screen.getByRole('button', { name: '显示' }))
    for (const label of ['描述', 'Agent Preset', 'Workspace / 目录', '执行轮次', '更新时间']) {
      fireEvent.click(screen.getByRole('checkbox', { name: label }))
    }
    expect(current.onToggleDisplay).toHaveBeenCalledTimes(5)
    fireEvent.click(screen.getByRole('button', { name: '显示' }))

    fireEvent.click(screen.getByRole('button', { name: '新建任务' }))
    fireEvent.click(screen.getByRole('button', { name: '在此列新建任务 初始化' }))
    fireEvent.click(screen.getByRole('button', { name: '在此列新建任务 待审核' }))
    expect(current.onCreate).toHaveBeenNthCalledWith(1)
    expect(current.onCreate).toHaveBeenCalledWith('initialized')
    expect(current.onCreate).toHaveBeenCalledWith('review')

    fireEvent.click(screen.getByRole('button', { name: /DSH-1 Task 1/ }))
    expect(current.onOpenTask).toHaveBeenCalledWith(tasks[0]!.id)
    fireEvent.click(screen.getByRole('button', { name: '看板' }))
    fireEvent.click(screen.getByRole('button', { name: '列表' }))
    expect(current.onViewModeChange).toHaveBeenNthCalledWith(1, 'board')
    expect(current.onViewModeChange).toHaveBeenNthCalledWith(2, 'list')

    view.rerender(<TaskBoardView {...current} viewMode="list" />)
    expect(screen.getByRole('table', { name: '任务列表' })).toBeDefined()
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
    fireEvent.click(within(screen.getByRole('table')).getByRole('button', { name: /Task 2/ }))
    expect(current.onOpenTask).toHaveBeenCalledWith(tasks[1]!.id)

    view.rerender(<TaskBoardView {...current} query="no match" />)
    expect(screen.queryByRole('button', { name: /DSH-1 Task 1/ })).toBeNull()
    view.rerender(<TaskBoardView {...current} statusFilter="running" />)
    expect(screen.getByRole('button', { name: /DSH-3 Task 3/ })).toBeDefined()
    view.rerender(<TaskBoardView {...current} locationFilter="none" />)
    expect(screen.getByRole('button', { name: /DSH-3 Task 3/ })).toBeDefined()
    view.rerender(<TaskBoardView {...current} agentPresetFilter="Backend" />)
    expect(screen.getByRole('button', { name: /DSH-1 Task 1/ })).toBeDefined()
    view.rerender(<TaskBoardView {...current} display={{
      description: false,
      agentPreset: false,
      location: false,
      rounds: false,
      updatedAt: false,
    }} />)
    expect(screen.queryAllByText('Harness Workspace')).toHaveLength(1)
  })

  it('projects drag lifecycle into forbidden feedback and same-column reorder actions', () => {
    const current = props()
    render(<TaskBoardView {...current} />)
    const context = () => dndState.contextProps as {
      readonly onDragStart: (event: unknown) => void
      readonly onDragCancel: () => void
      readonly onDragEnd: (event: unknown) => void
    }

    act(() => {
      context().onDragStart({ active: { id: tasks[0]!.id } })
    })
    const taskButtons = screen.getAllByRole('button', { name: /DSH-1 Task 1/ })
    expect(taskButtons).toHaveLength(2)
    fireEvent.click(taskButtons[1]!)
    act(() => {
      context().onDragCancel()
      context().onDragStart({ active: { id: 'missing-task' } })
    })
    expect(screen.getAllByRole('button', { name: /DSH-1 Task 1/ })).toHaveLength(1)

    act(() => {
      context().onDragEnd({ active: { id: tasks[0]!.id }, over: null })
      context().onDragEnd({ active: { id: tasks[0]!.id }, over: { id: tasks[2]!.id } })
    })
    expect(screen.getByRole('status').textContent).toContain('不能拖到其他状态列')
    act(() => {
      context().onDragStart({ active: { id: tasks[0]!.id } })
      context().onDragEnd({ active: { id: tasks[0]!.id }, over: { id: tasks[0]!.id } })
      context().onDragEnd({ active: { id: tasks[0]!.id }, over: { id: tasks[1]!.id } })
    })
    expect(current.onReorder).toHaveBeenCalledWith(tasks[0]!.id, undefined)
  })
})
