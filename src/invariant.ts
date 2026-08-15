/** Package-owned task, round, Session, and event invariants. @module @deepseek-ai/dsh-task-board/invariant */

import { isDeepStrictEqual } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TaskBoardChange, TaskBoardTask, TaskBoardTaskId } from './types.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-task-board'

/** Cordis companion plugin name. */
export const name = 'task-board-invariant'

/** Invariant registry must exist before this companion registers. */
export const inject = ['invariants']

function validateTask(task: TaskBoardTask, fail: InvariantFailure): void {
  const active = task.rounds.filter(round => round.status === 'starting' || round.status === 'running')
  if (task.status === 'running') {
    if (active.length !== 1 || task.rounds.at(-1) !== active[0]) {
      fail(`running task '${task.id}' must own exactly one active latest round`)
    }
  } else if (active.length !== 0) {
    fail(`non-running task '${task.id}' owns an active round`)
  }
  task.rounds.forEach((round, index) => {
    if (round.ordinal !== index + 1) {
      fail(`task '${task.id}' round ordinals are not contiguous at '${round.id}'`)
    }
  })
  const activityIds = new Set(task.activity.map(activity => activity.id))
  if (activityIds.size !== task.activity.length) fail(`task '${task.id}' contains duplicate activity ids`)
}

function validateAll(tasks: readonly TaskBoardTask[], fail: InvariantFailure): void {
  const owners = new Map<SessionId, TaskBoardTaskId>()
  for (const task of tasks) {
    validateTask(task, fail)
    for (const round of task.rounds) {
      const owner = owners.get(round.sessionId)
      if (owner !== undefined && owner !== task.id) {
        fail(`Session '${round.sessionId}' is owned by tasks '${owner}' and '${task.id}'`)
      }
      owners.set(round.sessionId, task.id)
    }
  }
}

function validateChange(ctx: Context, change: TaskBoardChange, fail: InvariantFailure): void {
  const authoritative = ctx.taskBoard.getTask(change.taskId)
  if (change.operation === 'deleted') {
    if (authoritative !== undefined || change.task !== undefined) {
      fail(`deleted event for '${change.taskId}' still carries an authoritative task`)
    }
  } else if (authoritative === undefined || change.task === undefined
    || !isDeepStrictEqual(authoritative, change.task)) {
    fail(`event task '${change.taskId}' does not equal authoritative task`)
  }
  if (change.boardRevision !== ctx.taskBoard.currentBoardRevision()) {
    fail(`event board revision ${change.boardRevision} does not equal authoritative revision`)
  }
  validateAll(ctx.taskBoard.inspectTasks(), fail)
}

const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  validateAll(ctx.taskBoard.inspectTasks(), fail)
  ctx.on('task-board/changed', (change) => { validateChange(ctx, change, fail) }, { global: true })
}, { inject: ['taskBoard'] })

/**
 * Register the task-board package invariant companion.
 * @param ctx - Cordis context carrying the invariant registry.
 * @returns Installed registration disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
