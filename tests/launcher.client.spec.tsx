// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { TaskBoardStatus, TaskBoardTask, TaskBoardTaskId } from '../src/types.ts'
import type { TaskBoardClientStatus, TaskBoardClientView } from '../src/client/controller.ts'
import { zh } from '../src/client/locales.ts'
import type { TaskBoardLauncherProps } from '../src/client/slots.ts'
import { createTaskBoardStore } from '../src/client/store.ts'
import { TaskBoardLauncher } from '../src/client/TaskBoardLauncher.tsx'

afterEach(cleanup)

const t: TaskBoardLauncherProps['t'] = makeTranslate(zh)

function task(id: string, status: TaskBoardStatus): TaskBoardTask {
  const sequence = Number(id.replace(/\D/g, '')) || 1
  return {
    id: id as TaskBoardTaskId,
    sequence,
    identifier: `DSH-${sequence}`,
    revision: 1,
    title: `Task ${sequence}`,
    titleMode: 'manual',
    description: 'Requirement',
    acceptanceCriteria: '',
    status,
    position: String(sequence),
    attachments: [],
    rounds: [],
    activity: [],
    createdAt: sequence,
    updatedAt: sequence,
  }
}

function mount(options: {
  readonly wide: boolean
  readonly status: TaskBoardClientStatus
  readonly tasks?: readonly TaskBoardTask[]
  readonly open?: boolean
}) {
  const ui = createTaskBoardStore().create()
  if (options.open === true) ui.actions.open()
  const board = createSnapshotStore<TaskBoardClientView>({
    status: options.status,
    boardRevision: 1,
    tasks: options.tasks ?? [],
    pendingTaskIds: [],
    creating: false,
    error: null,
  })
  const refresh = vi.fn(async () => ({ ok: true as const, value: board.getSnapshot().tasks }))
  const props = {
    wide: options.wide,
    useStore: bindSnapshotSelector(ui),
    actions: ui.actions,
    useBoard: bindSnapshotSelector(board),
    refresh,
    t,
  } as TaskBoardLauncherProps
  render(<TaskBoardLauncher {...props} />)
  return { refresh, ui }
}

describe('TaskBoardLauncher', () => {
  it.each(['cold', 'error'] as const)('opens and refreshes a collapsed %s board', (status) => {
    const { refresh, ui } = mount({ wide: false, status })
    const button = screen.getByRole('button', { name: '任务面板' })

    expect(button.getAttribute('title')).toBe('任务面板')
    expect(button.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(button)

    expect(ui.getSnapshot().open).toBe(true)
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('renders wide active count without refreshing an already-ready board', () => {
    const { refresh } = mount({
      wide: true,
      status: 'ready',
      open: true,
      tasks: [task('task-1', 'running'), task('task-2', 'running'), task('task-3', 'done')],
    })
    const button = screen.getByRole('button', { name: /任务面板/ })

    expect(button.getAttribute('data-wide')).toBe('true')
    expect(button.getAttribute('title')).toBeNull()
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByLabelText('2 个 Agent 正在工作').textContent).toContain('2')
    fireEvent.click(button)

    expect(refresh).not.toHaveBeenCalled()
  })
})
