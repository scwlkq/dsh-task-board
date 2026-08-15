import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TaskBoardChange, TaskBoardTask } from '../src/types.ts'
import { setupTaskBoard } from './helpers.ts'

const active: Array<{ dispose(): Promise<void> }> = []

afterEach(async () => {
  await Promise.all(active.splice(0).map(harness => harness.dispose()))
})

describe('task-board invariant companion', () => {
  async function preparedTask() {
    const harness = await setupTaskBoard({ invariants: true })
    active.push(harness)
    const created = await harness.service.create({
      title: '',
      description: 'Invariant task',
      acceptanceCriteria: '',
      start: false,
    })
    if (!created.ok) throw new Error('test task creation failed')
    return { harness, task: created.value }
  }

  function updatedChange(harness: Awaited<ReturnType<typeof setupTaskBoard>>, task: TaskBoardTask): TaskBoardChange {
    return {
      boardRevision: harness.service.currentBoardRevision(),
      operation: 'updated',
      taskId: task.id,
      task,
    }
  }

  it('accepts committed service mutations and rejects forged event projection', async () => {
    const { harness, task } = await preparedTask()
    expect(() => {
      harness.ctx.emit('task-board/changed', {
        boardRevision: 2,
        operation: 'updated',
        taskId: task.id,
        task: { ...task, title: 'forged' },
      })
    }).toThrow(/does not equal authoritative task/)
  })

  it('rejects deleted events that retain authoritative or projected task data', async () => {
    const { harness, task } = await preparedTask()
    expect(() => {
      harness.ctx.emit('task-board/changed', {
        boardRevision: harness.service.currentBoardRevision(),
        operation: 'deleted',
        taskId: task.id,
      })
    }).toThrow(/still carries an authoritative task/)

    const getTask = vi.spyOn(harness.service, 'getTask').mockReturnValue(undefined)
    expect(() => {
      harness.ctx.emit('task-board/changed', {
        boardRevision: harness.service.currentBoardRevision(),
        operation: 'deleted',
        taskId: task.id,
        task,
      } as TaskBoardChange)
    }).toThrow(/still carries an authoritative task/)
    expect(() => {
      harness.ctx.emit('task-board/changed', {
        boardRevision: harness.service.currentBoardRevision(),
        operation: 'deleted',
        taskId: task.id,
      })
    }).not.toThrow()
    getTask.mockRestore()
  })

  it('rejects incomplete updated events and mismatched board revisions', async () => {
    const { harness, task } = await preparedTask()
    const getTask = vi.spyOn(harness.service, 'getTask').mockReturnValue(undefined)
    expect(() => {
      harness.ctx.emit('task-board/changed', updatedChange(harness, task))
    }).toThrow(/does not equal authoritative task/)
    getTask.mockRestore()

    expect(() => {
      harness.ctx.emit('task-board/changed', {
        boardRevision: harness.service.currentBoardRevision(),
        operation: 'updated',
        taskId: task.id,
      } as TaskBoardChange)
    }).toThrow(/does not equal authoritative task/)
    expect(() => {
      harness.ctx.emit('task-board/changed', {
        ...updatedChange(harness, task),
        boardRevision: harness.service.currentBoardRevision() + 1,
      })
    }).toThrow(/does not equal authoritative revision/)
  })

  it('rejects invalid active-round ownership and non-contiguous ordinals', async () => {
    const { harness, task } = await preparedTask()
    const started = await harness.service.start({ id: task.id, revision: task.revision })
    if (!started.ok) throw new Error('test task start failed')
    const running = started.value
    const inspect = vi.spyOn(harness.service, 'inspectTasks')

    inspect.mockReturnValue([{ ...running, rounds: [] }])
    expect(() => { harness.ctx.emit('task-board/changed', updatedChange(harness, running)) }).toThrow(
      /exactly one active latest round/,
    )

    inspect.mockReturnValue([{ ...running, status: 'initialized' }])
    expect(() => { harness.ctx.emit('task-board/changed', updatedChange(harness, running)) }).toThrow(
      /non-running task.*active round/,
    )

    inspect.mockReturnValue([{
      ...running,
      rounds: running.rounds.map(round => ({ ...round, ordinal: 2 })),
    }])
    expect(() => { harness.ctx.emit('task-board/changed', updatedChange(harness, running)) }).toThrow(
      /ordinals are not contiguous/,
    )
  })

  it('rejects duplicate activity ids and Session ownership shared across tasks', async () => {
    const { harness, task } = await preparedTask()
    const inspect = vi.spyOn(harness.service, 'inspectTasks')
    inspect.mockReturnValue([{
      ...task,
      activity: [task.activity[0]!, task.activity[0]!],
    }])
    expect(() => { harness.ctx.emit('task-board/changed', updatedChange(harness, task)) }).toThrow(
      /duplicate activity ids/,
    )

    const started = await harness.service.start({ id: task.id, revision: task.revision })
    if (!started.ok) throw new Error('test task start failed')
    const duplicateOwner = {
      ...started.value,
      id: 'task-duplicate-owner' as never,
      sequence: started.value.sequence + 1,
      identifier: 'DSH-duplicate',
    }
    inspect.mockReturnValue([started.value, duplicateOwner])
    expect(() => { harness.ctx.emit('task-board/changed', updatedChange(harness, started.value)) }).toThrow(
      /is owned by tasks/,
    )
  })
})
