/** Pure task-card drop resolution shared by DnD UI and tests. */

import type {
  TaskBoardStatus,
  TaskBoardTask,
  TaskBoardTaskId,
} from '../types.ts'

/** Prefix used for empty-column and append drop targets. */
export const TASK_BOARD_COLUMN_PREFIX = 'task-board-column:'

/** Result of resolving one card drop without mutating workflow state. */
export type TaskDropResolution =
  | { readonly kind: 'ignore' }
  | { readonly kind: 'reorder'; readonly beforeTaskId?: TaskBoardTaskId }
  | {
    readonly kind: 'forbidden'
    readonly sourceStatus: TaskBoardStatus
    readonly targetStatus: TaskBoardStatus
  }

function statusFromColumnId(id: string): TaskBoardStatus | undefined {
  if (!id.startsWith(TASK_BOARD_COLUMN_PREFIX)) return undefined
  const status = id.slice(TASK_BOARD_COLUMN_PREFIX.length)
  switch (status) {
    case 'initialized':
    case 'running':
    case 'review':
    case 'done':
    case 'failed':
      return status
    default:
      return undefined
  }
}

/**
 * Resolve DnD intent into a same-column reorder or forbidden state change.
 * @param tasks - current authoritative display ordering.
 * @param activeId - dragged card identity.
 * @param overId - card or column drop target identity.
 * @returns a pure mutation decision.
 */
export function resolveTaskDrop(
  tasks: readonly TaskBoardTask[],
  activeId: TaskBoardTaskId,
  overId: TaskBoardTaskId | string,
): TaskDropResolution {
  const active = tasks.find(task => task.id === activeId)
  if (active === undefined) return { kind: 'ignore' }

  const target = tasks.find(task => task.id === overId)
  const targetStatus = target?.status ?? statusFromColumnId(String(overId))
  if (targetStatus === undefined) return { kind: 'ignore' }
  if (targetStatus !== active.status) {
    return {
      kind: 'forbidden',
      sourceStatus: active.status,
      targetStatus,
    }
  }
  if (target?.id === active.id) return { kind: 'ignore' }

  const peers = tasks.filter(task => task.status === active.status && task.id !== active.id)
  if (target === undefined) return { kind: 'reorder' }
  const targetIndex = peers.findIndex(task => task.id === target.id)

  const originalIndex = tasks
    .filter(task => task.status === active.status)
    .findIndex(task => task.id === active.id)
  const beforeTaskId = originalIndex <= targetIndex
    ? peers[targetIndex + 1]?.id
    : peers[targetIndex]?.id
  return beforeTaskId === undefined
    ? { kind: 'reorder' }
    : { kind: 'reorder', beforeTaskId }
}
