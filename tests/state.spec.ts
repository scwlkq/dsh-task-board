import { describe, expect, it } from 'vitest'
import {
  taskBoardDomainSpec,
  taskBoardGlobalSchema,
  taskBoardTaskSchema,
} from '../src/host/spec.ts'
import {
  appendPromptRecord,
  approveTaskRecord,
  composeInitialPrompt,
  createTaskRecord,
  deleteAllowed,
  editTaskRecord,
  failRoundAdmissionRecord,
  markRoundRunningRecord,
  projectRoundOutcome,
  recordRoundEvidence,
  reconcileRound,
  rejectTaskRecord,
  requestStopRecord,
  reopenTaskRecord,
  reorderTaskRecord,
  retryTaskRecord,
  rollbackPromptRecord,
  snapshotBoard,
  snapshotTask,
  startRoundRecord,
} from '../src/host/state.ts'
import type {
  TaskBoardActivityId,
  TaskBoardPromptId,
  TaskBoardRoundId,
  TaskBoardTask,
  TaskBoardTaskId,
} from '../src/types.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { TaskBoardSessionRequestId } from '../src/host/session-types.ts'

function validTask() {
  return {
    id: 'task-1',
    sequence: 1,
    revision: 0,
    identifier: 'DSH-1',
    title: 'Implement search',
    titleMode: 'automatic',
    description: 'Implement task search.',
    acceptanceCriteria: '',
    status: 'initialized',
    position: '000000000001',
    attachments: [],
    rounds: [],
    activity: [],
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('task-board durable schemas', () => {
  it('accepts the version-zero initial global record', () => {
    expect(taskBoardGlobalSchema.parse({ nextSequence: 1, boardRevision: 0 })).toEqual({
      nextSequence: 1,
      boardRevision: 0,
    })
    expect(taskBoardDomainSpec.name).toBe('task_board')
    expect(taskBoardDomainSpec.version).toBe(0)
  })

  it('accepts a valid initialized task', () => {
    expect(taskBoardTaskSchema.safeParse(validTask()).success).toBe(true)
  })

  it('rejects unknown workflow states', () => {
    expect(taskBoardTaskSchema.safeParse({ ...validTask(), status: 'unknown' }).success).toBe(false)
  })

  it('rejects simultaneous Workspace and cwd ownership', () => {
    expect(taskBoardTaskSchema.safeParse({
      ...validTask(),
      workspaceId: 'workspace-1',
      cwd: '/tmp/project',
    }).success).toBe(false)
  })

  it('rejects negative compare-and-set revisions', () => {
    expect(taskBoardTaskSchema.safeParse({ ...validTask(), revision: -1 }).success).toBe(false)
  })
})

const taskId = (value: string) => value as TaskBoardTaskId
const roundId = (value: string) => value as TaskBoardRoundId
const promptId = (value: string) => value as TaskBoardPromptId
const activityId = (value: string) => value as TaskBoardActivityId
const sessionId = (value: string) => value as SessionId
const rpcId = (value: string) => TaskBoardSessionRequestId(value)

function initializedTask(sequence = 1): TaskBoardTask {
  return createTaskRecord({
    title: '',
    description: 'Implement search\nwith filters',
    acceptanceCriteria: 'Results update from literal text.',
    start: false,
  }, {
    id: taskId(`task-${sequence}`),
    sequence,
    position: String(sequence * 1_000_000).padStart(16, '0'),
    activityId: activityId(`activity-${sequence}`),
    now: sequence,
    automaticTitleMaxChars: 80,
  })
}

function runningTask(task = initializedTask(), session = sessionId('session-1')): TaskBoardTask {
  return startRoundRecord(task, {
    roundId: roundId(`round-${task.sequence}`),
    sessionId: session,
    trigger: 'initial',
    prompt: {
      id: promptId(`prompt-${task.sequence}`),
      rpcId: rpcId(`rpc-${task.sequence}`),
      kind: 'initial',
      text: task.description,
      acceptedAt: 10,
    },
    activityId: activityId(`activity-start-${task.sequence}`),
    now: 10,
  })
}

describe('task-board workflow core', () => {
  it('follows the exact successful workflow and rejects approval elsewhere', () => {
    const initialized = initializedTask()
    const running = runningTask(initialized)
    const review = reconcileRound(running, { kind: 'review', endSeq: 12 }, {
      activityId: activityId('activity-review'),
      now: 20,
    })
    const done = approveTaskRecord(review, {
      activityId: activityId('activity-approved'),
      now: 30,
    })

    expect(running.status).toBe('running')
    expect(review.status).toBe('review')
    expect(done.status).toBe('done')
    expect(done.completedAt).toBe(30)
    expect(() => approveTaskRecord(initialized, {
      activityId: activityId('invalid'),
      now: 30,
    })).toThrow(/invalid transition/)
  })

  it('starts rejection in the same Session and keeps round ordinals contiguous', () => {
    const first = runningTask()
    const review = reconcileRound(first, { kind: 'review', endSeq: 11 }, {
      activityId: activityId('activity-review'),
      now: 20,
    })
    const revision = rejectTaskRecord(review, {
      feedback: 'Add empty-state behavior.',
      roundId: roundId('round-2'),
      promptId: promptId('prompt-2'),
      rpcId: rpcId('rpc-2'),
      activityId: activityId('activity-reject'),
      now: 30,
    })

    expect(revision.status).toBe('running')
    expect(revision.currentSessionId).toBe(first.currentSessionId)
    expect(revision.rounds.map(round => round.ordinal)).toEqual([1, 2])
    expect(revision.rounds[1]).toMatchObject({
      trigger: 'revision',
      feedback: 'Add empty-state behavior.',
      sessionId: first.currentSessionId,
    })
  })

  it('creates a retry round only after explicit user action', () => {
    const running = runningTask()
    const failure = {
      stage: 'execution' as const,
      code: 'provider-error',
      message: 'The model request failed.',
    }
    const failed = reconcileRound(running, { kind: 'failed', failure, endSeq: 13 }, {
      activityId: activityId('activity-failed'),
      now: 20,
    })

    expect(failed.status).toBe('failed')
    expect(failed.rounds).toHaveLength(1)

    const retry = retryTaskRecord(failed, {
      sessionId: failed.currentSessionId!,
      roundId: roundId('round-2'),
      promptId: promptId('prompt-2'),
      rpcId: rpcId('rpc-2'),
      text: 'Retry the failed task.',
      activityId: activityId('activity-retry'),
      now: 30,
    })

    expect(retry.status).toBe('running')
    expect(retry.rounds).toHaveLength(2)
    expect(retry.rounds[1]).toMatchObject({ trigger: 'retry', ordinal: 2 })
  })

  it('keeps follow-up prompts inside the active round', () => {
    const running = runningTask()
    const followed = appendPromptRecord(running, {
      id: promptId('prompt-followup'),
      rpcId: rpcId('rpc-followup'),
      kind: 'followup',
      text: 'Also cover narrow screens.',
      acceptedAt: 15,
    }, {
      activityId: activityId('activity-followup'),
      now: 15,
    })

    expect(followed.rounds).toHaveLength(1)
    expect(followed.rounds[0]?.prompts).toHaveLength(2)
    expect(followed.rounds[0]?.prompts[1]?.kind).toBe('followup')
  })

  it('projects successful, failed, and cancelled terminal outcomes', () => {
    const failure = {
      stage: 'execution' as const,
      code: 'tool-error',
      message: 'A tool failed.',
    }

    expect(projectRoundOutcome([{ kind: 'completed' }])).toEqual({ kind: 'review' })
    expect(projectRoundOutcome([{ kind: 'error', failure }])).toEqual({ kind: 'failed', failure })
    expect(projectRoundOutcome([{ kind: 'cancelled', failure }])).toEqual({ kind: 'cancelled', failure })
  })

  it('reopens completed tasks and applies confirmation deletion rules', () => {
    const review = reconcileRound(runningTask(), { kind: 'review' }, {
      activityId: activityId('activity-review'),
      now: 20,
    })
    const done = approveTaskRecord(review, {
      activityId: activityId('activity-approved'),
      now: 30,
    })
    const reopened = reopenTaskRecord(done, {
      activityId: activityId('activity-reopened'),
      now: 40,
    })

    expect(reopened.status).toBe('initialized')
    expect(deleteAllowed(runningTask(), true)).toBe(false)
    expect(deleteAllowed(initializedTask(), false)).toBe(true)
    expect(deleteAllowed(done, false)).toBe(false)
    expect(deleteAllowed(done, true)).toBe(true)
  })

  it('reorders only within one status and returns deterministic positions', () => {
    const first = initializedTask(1)
    const second = initializedTask(2)
    const third = initializedTask(3)
    const result = reorderTaskRecord(second, [first, second, third], {
      beforeTaskId: first.id,
    }, { now: 20 })

    expect(result.task.position < first.position).toBe(true)
    expect(result.tasks.map(task => task.id)).toEqual([second.id, first.id, third.id])
    expect(() => reorderTaskRecord(second, [first, runningTask(second), third], {
      beforeTaskId: first.id,
    }, { now: 20 })).toThrow(/same status/)
  })

  it('derives automatic titles and preserves every optional creation field', () => {
    const attachment = {
      attachmentId: 'attachment-1',
      mediaType: 'image/png',
      bytes: 1,
      width: 1,
      height: 1,
      name: 'pixel.png',
    } as TaskBoardTask['attachments'][number]
    const created = createTaskRecord({
      title: '  ',
      description: '',
      acceptanceCriteria: '验收标题\n后续内容',
      workspaceId: 'workspace-1' as never,
      agentPreset: 'reviewer',
      attachments: [attachment],
      start: false,
    }, {
      id: taskId('task-options'),
      sequence: 9,
      position: '0000000900000000',
      activityId: activityId('activity-options'),
      now: 9,
      automaticTitleMaxChars: 2,
    })

    expect(created).toMatchObject({
      title: '验收',
      titleMode: 'automatic',
      workspaceId: 'workspace-1',
      agentPreset: 'reviewer',
      attachments: [attachment],
    })

    const manual = createTaskRecord({
      title: 'Manual',
      description: 'Description',
      acceptanceCriteria: '',
      cwd: '/tmp/project',
      start: false,
    }, {
      id: taskId('task-manual'),
      sequence: 10,
      position: '0000001000000000',
      activityId: activityId('activity-manual'),
      now: 10,
      automaticTitleMaxChars: 80,
    })
    expect(manual).toMatchObject({ title: 'Manual', titleMode: 'manual', cwd: '/tmp/project' })
    expect(manual.attachments).toEqual([])

    expect(() => createTaskRecord({
      title: '',
      description: 'Description',
      acceptanceCriteria: '',
      workspaceId: 'workspace-1' as never,
      cwd: '/tmp/project',
      start: false,
    }, {
      id: taskId('task-invalid-location'),
      sequence: 11,
      position: '0000001100000000',
      activityId: activityId('activity-invalid-location'),
      now: 11,
      automaticTitleMaxChars: 80,
    })).toThrow(/Workspace or cwd/)
    expect(() => createTaskRecord({
      title: '',
      description: 'Description',
      acceptanceCriteria: '',
      start: false,
    }, {
      id: taskId('task-invalid-title-limit'),
      sequence: 12,
      position: '0000001200000000',
      activityId: activityId('activity-invalid-title-limit'),
      now: 12,
      automaticTitleMaxChars: 0,
    })).toThrow(/title limit/)
  })

  it('edits material fields, clears alternatives, and preserves no-op revisions', () => {
    const attachment = {
      attachmentId: 'attachment-2',
      mediaType: 'image/png',
      bytes: 1,
      width: 1,
      height: 1,
    } as TaskBoardTask['attachments'][number]
    const initial = initializedTask()
    const noChange = editTaskRecord(initial, {
      title: initial.title,
      description: initial.description,
      acceptanceCriteria: initial.acceptanceCriteria,
      attachments: [],
    }, { activityId: activityId('activity-noop'), now: 20 }, 80)
    expect(noChange).toBe(initial)

    const withWorkspace = editTaskRecord(initial, {
      title: 'Manual title',
      description: 'Updated description',
      acceptanceCriteria: 'Updated criteria',
      workspaceId: 'workspace-2' as never,
      agentPreset: 'planner',
      attachments: [attachment],
    }, { activityId: activityId('activity-all-fields'), now: 20 }, 80)
    expect(withWorkspace).toMatchObject({
      title: 'Manual title',
      titleMode: 'manual',
      description: 'Updated description',
      acceptanceCriteria: 'Updated criteria',
      workspaceId: 'workspace-2',
      agentPreset: 'planner',
      attachments: [attachment],
    })
    expect(withWorkspace.activity.at(-1)).toMatchObject({
      operation: 'edited',
      fields: ['title', 'description', 'acceptanceCriteria', 'workspaceId', 'agentPreset', 'attachments'],
    })

    const withCwd = editTaskRecord(withWorkspace, {
      cwd: '/tmp/other',
      workspaceId: null,
      agentPreset: null,
    }, { activityId: activityId('activity-cwd'), now: 21 }, 80)
    expect(withCwd.cwd).toBe('/tmp/other')
    expect(withCwd.workspaceId).toBeUndefined()
    expect(withCwd.agentPreset).toBeUndefined()

    const reset = editTaskRecord(withCwd, {
      resetAutomaticTitle: true,
      description: 'Automatic replacement\nignored',
      cwd: null,
    }, { activityId: activityId('activity-reset'), now: 22 }, 4)
    expect(reset).toMatchObject({ title: 'Auto', titleMode: 'automatic' })
    expect(reset.cwd).toBeUndefined()

    const manualAgain = editTaskRecord(withWorkspace, { title: 'Another manual title' }, {
      activityId: activityId('activity-manual-again'),
      now: 23,
    }, 80)
    expect(manualAgain.titleMode).toBe('manual')
    const automaticAgain = editTaskRecord(initial, {
      resetAutomaticTitle: true,
      acceptanceCriteria: 'Replacement criteria',
    }, { activityId: activityId('activity-automatic-again'), now: 24 }, 80)
    expect(automaticAgain.titleMode).toBe('automatic')

    const cwdOnly = editTaskRecord(initial, { cwd: '/tmp/owned' }, {
      activityId: activityId('activity-cwd-only'),
      now: 25,
    }, 80)
    expect(editTaskRecord(cwdOnly, { cwd: '/tmp/owned' }, {
      activityId: activityId('activity-same-cwd'),
      now: 25,
    }, 80)).toBe(cwdOnly)
    expect(editTaskRecord(withWorkspace, { agentPreset: 'planner' }, {
      activityId: activityId('activity-same-preset'),
      now: 25,
    }, 80)).toBe(withWorkspace)
    const switchedToWorkspace = editTaskRecord(cwdOnly, { workspaceId: 'workspace-4' as never }, {
      activityId: activityId('activity-switch-workspace'),
      now: 26,
    }, 80)
    expect(switchedToWorkspace.cwd).toBeUndefined()
    expect(switchedToWorkspace.workspaceId).toBe('workspace-4')
    const switchedToCwd = editTaskRecord(withWorkspace, { cwd: '/tmp/switched' }, {
      activityId: activityId('activity-switch-cwd'),
      now: 27,
    }, 80)
    expect(switchedToCwd.workspaceId).toBeUndefined()
    expect(switchedToCwd.cwd).toBe('/tmp/switched')

    expect(() => editTaskRecord(runningTask(), { title: 'Blocked' }, {
      activityId: activityId('activity-running-edit'),
      now: 30,
    }, 80)).toThrow(/cannot edit from running/)
    expect(() => editTaskRecord(initial, { title: 'Title', resetAutomaticTitle: true }, {
      activityId: activityId('activity-title-conflict'),
      now: 30,
    }, 80)).toThrow(/title and resetAutomaticTitle/)
    expect(() => editTaskRecord(initial, {
      workspaceId: 'workspace-3' as never,
      cwd: '/tmp/conflict',
    }, { activityId: activityId('activity-location-conflict'), now: 30 }, 80)).toThrow(/Workspace or cwd/)
  })

  it('records admission, evidence, rollback, and stop intent around one active round', () => {
    const starting = runningTask()
    const admitted = markRoundRunningRecord(starting, { now: 11 })
    expect(admitted.rounds.at(-1)?.status).toBe('running')
    expect(markRoundRunningRecord(admitted, { now: 12 })).toBe(admitted)

    const prompt = admitted.rounds[0]!.prompts[0]!
    const withEvidence = recordRoundEvidence(admitted, [{
      promptId: prompt.id,
      messageSeq: 3,
      turn: 1,
      turnStartSeq: 2,
    }], 13)
    expect(withEvidence.rounds[0]).toMatchObject({ startSeq: 2 })
    expect(withEvidence.rounds[0]?.prompts[0]).toMatchObject({ messageSeq: 3, turn: 1 })
    expect(recordRoundEvidence(withEvidence, [{
      promptId: prompt.id,
      messageSeq: 3,
      turn: 1,
      turnStartSeq: 2,
    }], 14)).toBe(withEvidence)
    expect(recordRoundEvidence(withEvidence, [{
      promptId: promptId('prompt-unmatched'),
      messageSeq: 4,
      turn: 2,
      turnStartSeq: 4,
    }], 14)).toBe(withEvidence)

    const ended = recordRoundEvidence(withEvidence, [{
      promptId: prompt.id,
      messageSeq: 3,
      turn: 1,
      turnStartSeq: 2,
      turnEndSeq: 8,
    }], 15)
    expect(ended.rounds[0]).toMatchObject({ startSeq: 2, endSeq: 8 })

    const followupId = promptId('prompt-rollback')
    const followed = appendPromptRecord(ended, {
      id: followupId,
      rpcId: rpcId('rpc-rollback'),
      kind: 'followup',
      text: 'Rollback me',
      acceptedAt: 16,
    }, { activityId: activityId('activity-rollback'), now: 16 })
    const rolledBack = rollbackPromptRecord(followed, followupId, 17)
    expect(rolledBack.rounds[0]?.prompts).toHaveLength(1)
    expect(rolledBack.activity.some(item => item.operation === 'followup')).toBe(false)
    expect(rollbackPromptRecord(rolledBack, followupId, 18)).toBe(rolledBack)
    const systemPrompt = appendPromptRecord(rolledBack, {
      id: promptId('prompt-system'),
      rpcId: rpcId('rpc-system'),
      kind: 'feedback',
      text: 'System-staged feedback',
      acceptedAt: 18,
    }, { activityId: activityId('activity-system-prompt'), now: 18 })
    expect(systemPrompt.activity).toEqual(rolledBack.activity)

    const stopping = requestStopRecord(rolledBack, {
      activityId: activityId('activity-stop'),
      now: 19,
    })
    expect(stopping.activity.at(-1)).toMatchObject({ operation: 'stopped' })
    expect(() => markRoundRunningRecord(initializedTask(), { now: 20 })).toThrow(/invalid transition/)
    expect(() => requestStopRecord(initializedTask(), {
      activityId: activityId('activity-invalid-stop'),
      now: 20,
    })).toThrow(/invalid transition/)
    expect(() => markRoundRunningRecord({
      ...initializedTask(),
      status: 'running',
      currentSessionId: sessionId('session-no-round'),
    }, { now: 20 })).toThrow(/round is not active/)
  })

  it('restores the prior workflow state after admission failures', () => {
    const failure = {
      stage: 'prompt-admission' as const,
      code: 'PROMPT_REJECTED',
      message: 'Prompt rejected.',
    }
    const initialFailure = failRoundAdmissionRecord(runningTask(), failure, {
      activityId: activityId('activity-initial-failure'),
      now: 20,
    })
    expect(initialFailure).toMatchObject({ status: 'initialized', lastStartFailure: failure })
    expect(initialFailure.currentSessionId).toBeUndefined()
    expect(initialFailure.rounds.at(-1)).toMatchObject({ status: 'failed', failure })

    const review = reconcileRound(markRoundRunningRecord(runningTask(), { now: 11 }), {
      kind: 'review',
      endSeq: 10,
    }, { activityId: activityId('activity-review-for-failure'), now: 20 })
    const revision = rejectTaskRecord(review, {
      feedback: 'Try again.',
      roundId: roundId('round-revision-failure'),
      promptId: promptId('prompt-revision-failure'),
      rpcId: rpcId('rpc-revision-failure'),
      activityId: activityId('activity-revision-failure'),
      now: 30,
    })
    const restoredReview = failRoundAdmissionRecord(revision, failure, {
      activityId: activityId('activity-restored-review'),
      now: 31,
    })
    expect(restoredReview.status).toBe('review')
    expect(restoredReview.currentSessionId).toBe(review.currentSessionId)

    expect(() => failRoundAdmissionRecord(initializedTask(), failure, {
      activityId: activityId('activity-invalid-failure'),
      now: 40,
    })).toThrow(/invalid transition/)
  })

  it('uses the latest terminal signal and retains optional terminal sequences', () => {
    const failure = {
      stage: 'execution' as const,
      code: 'FAILED',
      message: 'Failed.',
    }
    expect(projectRoundOutcome([])).toEqual({ kind: 'running' })
    expect(projectRoundOutcome([
      { kind: 'completed', endSeq: 4 },
      { kind: 'error', failure, endSeq: 5 },
      { kind: 'cancelled', failure, endSeq: 6 },
    ])).toEqual({ kind: 'cancelled', failure, endSeq: 6 })

    const admitted = markRoundRunningRecord(runningTask(), { now: 11 })
    expect(reconcileRound(admitted, { kind: 'running' }, {
      activityId: activityId('activity-running-projection'),
      now: 12,
    })).toBe(admitted)
    expect(reconcileRound(runningTask(), { kind: 'running' }, {
      activityId: activityId('activity-starting-projection'),
      now: 12,
    }).rounds.at(-1)?.status).toBe('running')
    const failed = reconcileRound(admitted, { kind: 'failed', failure }, {
      activityId: activityId('activity-failed-projection'),
      now: 13,
    })
    expect(failed).toMatchObject({ status: 'failed' })
    expect(failed.rounds.at(-1)).toMatchObject({ status: 'failed', failure })
    const cancelled = reconcileRound(admitted, { kind: 'cancelled', failure, endSeq: 8 }, {
      activityId: activityId('activity-cancelled-projection'),
      now: 14,
    })
    expect(cancelled.rounds.at(-1)).toMatchObject({ status: 'cancelled', endSeq: 8, failure })
  })

  it('validates review and retry preconditions before creating another round', () => {
    const review = reconcileRound(markRoundRunningRecord(runningTask(), { now: 11 }), {
      kind: 'review',
    }, { activityId: activityId('activity-review-validation'), now: 20 })
    expect(() => rejectTaskRecord(review, {
      feedback: '   ',
      roundId: roundId('round-blank-feedback'),
      promptId: promptId('prompt-blank-feedback'),
      rpcId: rpcId('rpc-blank-feedback'),
      activityId: activityId('activity-blank-feedback'),
      now: 30,
    })).toThrow(/feedback is blank/)
    const { currentSessionId: _currentSessionId, ...reviewWithoutSession } = review
    expect(() => rejectTaskRecord(reviewWithoutSession, {
      feedback: 'Retry.',
      roundId: roundId('round-no-session'),
      promptId: promptId('prompt-no-session'),
      rpcId: rpcId('rpc-no-session'),
      activityId: activityId('activity-no-session'),
      now: 30,
    })).toThrow(/no current Session/)
    expect(() => startRoundRecord(runningTask(), {
      roundId: roundId('round-active'),
      sessionId: sessionId('session-active'),
      trigger: 'initial',
      prompt: {
        id: promptId('prompt-active'),
        rpcId: rpcId('rpc-active'),
        kind: 'initial',
        text: 'Duplicate.',
        acceptedAt: 30,
      },
      activityId: activityId('activity-active'),
      now: 30,
    })).toThrow(/round already active/)
    expect(() => retryTaskRecord(initializedTask(), {
      sessionId: sessionId('session-invalid-retry'),
      roundId: roundId('round-invalid-retry'),
      promptId: promptId('prompt-invalid-retry'),
      rpcId: rpcId('rpc-invalid-retry'),
      text: 'Retry.',
      activityId: activityId('activity-invalid-retry'),
      now: 30,
    })).toThrow(/invalid transition/)
  })

  it('rebalances malformed or exhausted positions and rejects incomplete columns', () => {
    const first = initializedTask(1)
    const second = initializedTask(2)
    const unchanged = reorderTaskRecord(second, [first, second], {}, { now: 20 })
    expect(unchanged.changed).toEqual([])
    expect(reorderTaskRecord(second, [first, second], { beforeTaskId: second.id }, { now: 20 }).changed).toEqual([])
    expect(() => reorderTaskRecord(second, [first], {}, { now: 20 })).toThrow(/exactly once/)
    expect(() => reorderTaskRecord(second, [first, second, second], {}, { now: 20 })).toThrow(/exactly once/)
    expect(() => reorderTaskRecord(second, [first, second], {
      beforeTaskId: taskId('missing-anchor'),
    }, { now: 20 })).toThrow(/anchor/)

    const adjacentFirst = { ...first, position: '0000000000000001' }
    const adjacentSecond = { ...second, position: '0000000000000002' }
    const rebalanced = reorderTaskRecord(adjacentSecond, [adjacentFirst, adjacentSecond], {
      beforeTaskId: adjacentFirst.id,
    }, { now: 21 })
    expect(rebalanced.tasks.map(task => task.position)).toEqual([
      '0000000001000000',
      '0000000002000000',
    ])
    expect(rebalanced.changed).toHaveLength(2)

    const malformed = { ...second, position: 'invalid' }
    expect(reorderTaskRecord(malformed, [first, malformed], {}, { now: 22 }).task.position).toBe('0000000002000000')
    const malformedPeer = { ...first, position: 'invalid' }
    expect(reorderTaskRecord(second, [malformedPeer, second], {}, { now: 22 }).task.position).toBe('0000000002000000')
    expect(reorderTaskRecord(second, [malformedPeer, second], {
      beforeTaskId: malformedPeer.id,
    }, { now: 22 }).task.position).toBe('0000000001000000')
    const zeroPeer = { ...first, position: '0' }
    expect(reorderTaskRecord(second, [zeroPeer, second], {}, { now: 22 }).task.position).toBe('0000000002000000')
    const unsafePeer = { ...first, position: '999999999999999999999' }
    expect(reorderTaskRecord(second, [unsafePeer, second], {}, { now: 22 }).task.position).toBe('0000000002000000')
    const exhausted = { ...first, position: String(Number.MAX_SAFE_INTEGER) }
    expect(reorderTaskRecord(second, [exhausted, second], {}, { now: 23 }).tasks).toHaveLength(2)
  })

  it('sorts snapshots and composes each prompt form', () => {
    const first = initializedTask(1)
    const second = { ...initializedTask(2), position: first.position }
    const review = reconcileRound(markRoundRunningRecord(runningTask(initializedTask(3)), { now: 11 }), {
      kind: 'review',
    }, { activityId: activityId('activity-sort-review'), now: 20 })
    const snapshot = snapshotBoard([review, second, first], 9)
    expect(snapshot.tasks.map(task => task.id)).toEqual([first.id, second.id, review.id])

    expect(composeInitialPrompt({ ...first, acceptanceCriteria: '' })).toBe(first.description)
    expect(composeInitialPrompt({ ...first, description: '', acceptanceCriteria: 'Pass.' })).toBe('Acceptance criteria:\nPass.')
    expect(composeInitialPrompt({ ...first, description: 'Do it.', acceptanceCriteria: 'Pass.' })).toBe(
      'Do it.\n\nAcceptance criteria:\nPass.',
    )
    expect(deleteAllowed(review, false)).toBe(false)
    expect(deleteAllowed(review, true)).toBe(true)
    const failed = reconcileRound(markRoundRunningRecord(runningTask(initializedTask(4)), { now: 11 }), {
      kind: 'failed',
      failure: { stage: 'execution', code: 'FAILED', message: 'Failed.' },
    }, { activityId: activityId('activity-delete-failed'), now: 20 })
    expect(deleteAllowed(failed, false)).toBe(false)
    expect(deleteAllowed(failed, true)).toBe(true)
  })

  it('rejects task records that cannot be serialized losslessly', () => {
    expect(() => snapshotTask({
      ...initializedTask(),
      title: 1n as never,
    })).toThrow(/losslessly JSON serializable/)
    expect(() => snapshotBoard([], 1n as never)).toThrow(/losslessly JSON serializable/)
  })

  it('returns detached deeply immutable snapshots', () => {
    const source = runningTask()
    const snapshot = snapshotBoard([source], 7)
    const mutable = snapshot.tasks[0] as unknown as {
      title: string
      rounds: Array<{ prompts: Array<{ text: string }> }>
    }

    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.tasks[0]?.rounds[0]?.prompts)).toBe(true)
    expect(() => { mutable.title = 'changed' }).toThrow()
    expect(() => { mutable.rounds[0]!.prompts[0]!.text = 'changed' }).toThrow()
    expect(source.title).not.toBe('changed')
    expect(source.rounds[0]?.prompts[0]?.text).not.toBe('changed')
  })
})
