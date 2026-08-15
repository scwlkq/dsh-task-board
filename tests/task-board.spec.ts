import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { AttachmentError } from '@deepseek-ai/dsh-attachment'
import { SessionId } from '@deepseek-ai/dsh-session'
import TaskBoardService from '../src/host/service.ts'
import type { TaskBoardChange, TaskBoardTask, TaskBoardTaskId } from '../src/types.ts'
import { setupTaskBoard, TEST_CONFIG } from './helpers.ts'

const active: Array<{ dispose(): Promise<void> }> = []

afterEach(async () => {
  await Promise.all(active.splice(0).map(harness => harness.dispose()))
})

async function harness(options: Parameters<typeof setupTaskBoard>[0] = {}) {
  const value = await setupTaskBoard(options)
  active.push(value)
  return value
}

const createRequest = (description: string) => ({
  title: '',
  description,
  acceptanceCriteria: '',
  start: false,
} as const)

interface TestTaskTable {
  get(id: TaskBoardTaskId): TaskBoardTask | undefined
  put(id: TaskBoardTaskId, task: TaskBoardTask): Promise<void>
  delete(id: TaskBoardTaskId): Promise<boolean>
}

interface TestBoardGlobal {
  get(): { readonly nextSequence: number; readonly boardRevision: number }
  set(value: { readonly nextSequence: number; readonly boardRevision: number }): Promise<void>
}

function taskTable(service: TaskBoardService): TestTaskTable {
  return Reflect.get(service, 'tasks') as TestTaskTable
}

function boardGlobal(service: TaskBoardService): TestBoardGlobal {
  return Reflect.get(service, 'global') as TestBoardGlobal
}

describe('TaskBoardService durable CRUD', () => {
  it('stores task image uploads and rejects non-canonical base64', async () => {
    const { runtime, service } = await harness()

    await expect(service.uploadAttachment({
      mediaType: 'image/png',
      data: 'aGVsbG8=',
      name: 'reference.png',
    })).resolves.toMatchObject({
      ok: true,
      value: {
        mediaType: 'image/png',
        bytes: 5,
        name: 'reference.png',
      },
    })
    expect(runtime.savedImages).toEqual([{
      mediaType: 'image/png',
      data: new Uint8Array([104, 101, 108, 108, 111]),
      name: 'reference.png',
    }])

    await expect(service.uploadAttachment({
      mediaType: 'image/png',
      data: 'not base64',
    })).resolves.toEqual({
      ok: false,
      error: {
        code: 'invalid-request',
        field: 'attachment',
        message: 'Image upload must use canonical base64.',
      },
    })
  })

  it('classifies attachment admission and storage failures without leaking unknown errors', async () => {
    const { runtime, service } = await harness()
    runtime.nextAttachmentError = new AttachmentError('Image exceeds configured byte limit.', 'IMAGE_TOO_LARGE')

    await expect(service.uploadAttachment({
      mediaType: 'image/png',
      data: 'aGVsbG8=',
    })).resolves.toEqual({
      ok: false,
      error: {
        code: 'attachment-error',
        reason: 'IMAGE_TOO_LARGE',
        message: 'Image exceeds configured byte limit.',
      },
    })

    runtime.nextAttachmentError = new Error('/private/task-board/attachments is unavailable')
    await expect(service.uploadAttachment({
      mediaType: 'image/png',
      data: 'aGVsbG8=',
    })).resolves.toEqual({
      ok: false,
      error: {
        code: 'attachment-error',
        reason: 'ATTACHMENT_STORE_FAILED',
        message: 'Image upload could not be stored.',
      },
    })
  })

  it('allocates monotonic identifiers and returns authoritative snapshots', async () => {
    const { service } = await harness()
    const first = await service.create(createRequest('Implement search'))
    const second = await service.create(createRequest('Implement filters'))

    expect(first.ok && first.value.identifier).toBe('DSH-1')
    expect(second.ok && second.value.identifier).toBe('DSH-2')
    const snapshot = await service.snapshot()
    expect(snapshot.ok && snapshot.value.boardRevision).toBe(2)
    expect(snapshot.ok && snapshot.value.tasks.map(task => task.identifier)).toEqual(['DSH-1', 'DSH-2'])
  })

  it('enforces compare-and-set revisions and returns the current task on conflict', async () => {
    const { service } = await harness()
    const created = await service.create(createRequest('Implement search'))
    if (!created.ok) throw new Error('test task creation failed')

    const edited = await service.edit({ id: created.value.id, revision: 0 }, { title: 'Search' })
    const stale = await service.edit({ id: created.value.id, revision: 0 }, { title: 'Stale title' })

    expect(edited.ok && edited.value).toMatchObject({ title: 'Search', revision: 1, titleMode: 'manual' })
    expect(stale).toMatchObject({
      ok: false,
      error: { code: 'revision-conflict', current: { title: 'Search', revision: 1 } },
    })
  })

  it('publishes changes only after durable rows are readable', async () => {
    const { ctx, service } = await harness()
    const observed: Array<{ change: TaskBoardChange; title: string | undefined }> = []
    ctx.on('task-board/changed', (change) => {
      observed.push({ change, title: service.getTask(change.taskId)?.title })
    })

    const created = await service.create(createRequest('Implement search'))
    if (!created.ok) throw new Error('test task creation failed')
    await service.edit({ id: created.value.id, revision: 0 }, { title: 'Search' })
    await service.delete({ id: created.value.id, revision: 1 })

    expect(observed.map(item => [item.change.operation, item.change.boardRevision, item.title])).toEqual([
      ['created', 1, 'Implement search'],
      ['updated', 2, 'Search'],
      ['deleted', 3, undefined],
    ])
  })

  it('reorders cards only inside their current workflow column', async () => {
    const { service } = await harness()
    const first = await service.create(createRequest('First'))
    const second = await service.create(createRequest('Second'))
    const third = await service.create(createRequest('Third'))
    if (!first.ok || !second.ok || !third.ok) throw new Error('test task creation failed')

    const reordered = await service.reorder(
      { id: third.value.id, revision: third.value.revision },
      { beforeTaskId: first.value.id },
    )

    expect(reordered.ok).toBe(true)
    const snapshot = await service.snapshot()
    expect(snapshot.ok && snapshot.value.tasks.map(task => task.title)).toEqual(['Third', 'First', 'Second'])
  })

  it('deletes initialized cards and reports missing task identities', async () => {
    const { service } = await harness()
    const created = await service.create(createRequest('Disposable'))
    if (!created.ok) throw new Error('test task creation failed')

    await expect(service.delete({ id: created.value.id, revision: 0 })).resolves.toEqual({
      ok: true,
      value: { deleted: true, taskId: created.value.id },
    })
    await expect(service.delete({ id: created.value.id, revision: 0 })).resolves.toEqual({
      ok: false,
      error: { code: 'task-not-found', taskId: created.value.id },
    })
  })

  it('rejects invalid and oversized requests as stable business failures', async () => {
    const { service } = await harness()

    await expect(service.create(createRequest('   '))).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-request', field: 'description' },
    })
    await expect(service.create({
      ...createRequest('Valid'),
      workspaceId: 'workspace-1' as never,
      cwd: '/tmp/project',
    })).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-request', field: 'cwd' },
    })
    await expect(service.create(createRequest('x'.repeat(32_769)))).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-request', field: 'description' },
    })
  })

  it('serializes concurrent edits against one observed revision', async () => {
    const { service } = await harness()
    const created = await service.create(createRequest('Concurrent'))
    if (!created.ok) throw new Error('test task creation failed')

    const results = await Promise.all([
      service.edit({ id: created.value.id, revision: 0 }, { title: 'A' }),
      service.edit({ id: created.value.id, revision: 0 }, { title: 'B' }),
    ])

    expect(results.filter(result => result.ok)).toHaveLength(1)
    expect(results.filter(result => !result.ok && result.error.code === 'revision-conflict')).toHaveLength(1)
  })

  it('does not consume a revision when clearing an already absent optional field', async () => {
    const { service } = await harness()
    const created = await service.create(createRequest('No-op'))
    if (!created.ok) throw new Error('test task creation failed')

    const edited = await service.edit({ id: created.value.id, revision: 0 }, { workspaceId: null })
    expect(edited.ok && edited.value.revision).toBe(0)
    const snapshot = await service.snapshot()
    expect(snapshot.ok && snapshot.value.boardRevision).toBe(1)
  })

  it('drains an admitted task mutation that reaches the board queue during disposal', async () => {
    const { fiber, service } = await harness()
    const created = await service.create(createRequest('Drain'))
    if (!created.ok) throw new Error('test task creation failed')

    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const internals = service as unknown as {
      readonly taskTails: Map<TaskBoardTaskId, Promise<void>>
      readonly mutationAdmissionOpen: boolean
    }
    internals.taskTails.set(created.value.id, gate)
    const mutation = service.edit({ id: created.value.id, revision: 0 }, { title: 'Drained' })
    const disposal = fiber.dispose()
    await vi.waitFor(() => { expect(internals.mutationAdmissionOpen).toBe(false) })
    release()

    await expect(mutation).resolves.toMatchObject({ ok: true, value: { title: 'Drained' } })
    await disposal
  })

  it('contains post-commit observer errors without rejecting the mutation', async () => {
    const { ctx, service } = await harness()
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    ctx.on('task-board/changed', () => { throw new Error('observer failed') })

    await expect(service.create(createRequest('Committed'))).resolves.toMatchObject({ ok: true })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('task-board/changed listener failed'))
  })

  it('returns task-not-found for unknown branded ids', async () => {
    const { service } = await harness()
    const id = 'missing-task' as TaskBoardTaskId
    await expect(service.edit({ id, revision: 0 }, { title: 'Missing' })).resolves.toEqual({
      ok: false,
      error: { code: 'task-not-found', taskId: id },
    })
  })
})

describe('TaskBoardService Session orchestration', () => {
  it('creates and prompts a real Session before reconciling success to review', async () => {
    const { runtime, service } = await harness()
    const created = await service.create(createRequest('Execute search work'))
    if (!created.ok) throw new Error('test task creation failed')

    const started = await service.start({ id: created.value.id, revision: created.value.revision })
    expect(started.ok && started.value.status).toBe('running')
    expect(runtime.calls.map(call => call.method)).toEqual(['session.create', 'session.prompt'])
    if (!started.ok) throw new Error('test task start failed')
    const sessionId = started.value.currentSessionId!
    runtime.appendPromptTurn(sessionId, 0, { kind: 'completed' })
    runtime.setIdle(sessionId)
    await service.whenSettled(started.value.id)

    const review = service.getTask(started.value.id)
    expect(review?.status).toBe('review')
    expect(review?.rounds[0]).toMatchObject({ status: 'completed', startSeq: 1, endSeq: 3 })
    expect(review?.rounds[0]?.prompts[0]).toMatchObject({ messageSeq: 2, turn: 1, turnEndSeq: 3 })
  })

  it('creates and starts immediately when create.start is true', async () => {
    const { runtime, service } = await harness()
    const created = await service.create({ ...createRequest('Start now'), start: true })

    expect(created.ok && created.value.status).toBe('running')
    expect(runtime.calls.map(call => call.method)).toEqual(['session.create', 'session.prompt'])
  })

  it('restores the origin state when initial prompt admission is rejected', async () => {
    const { runtime, service } = await harness()
    const created = await service.create(createRequest('Rejected prompt'))
    if (!created.ok) throw new Error('test task creation failed')
    runtime.nextPromptError = {
      code: 'agent-busy',
      message: 'prompt rejected',
      details: { reason: 'busy' },
    }

    const started = await service.start({ id: created.value.id, revision: 0 })
    expect(started).toMatchObject({ ok: false, error: { code: 'prompt-rejected' } })
    expect(service.getTask(created.value.id)).toMatchObject({
      status: 'initialized',
      lastStartFailure: { stage: 'prompt-admission', code: 'agent-busy' },
      rounds: [{ status: 'failed' }],
    })
  })

  it('rejects review with feedback into a second round on the same Session', async () => {
    const { runtime, service } = await harness()
    const created = await service.create(createRequest('Review loop'))
    if (!created.ok) throw new Error('test task creation failed')
    const started = await service.start({ id: created.value.id, revision: 0 })
    if (!started.ok) throw new Error('test task start failed')
    const sessionId = started.value.currentSessionId!
    runtime.appendPromptTurn(sessionId, 0, { kind: 'completed' })
    runtime.setIdle(sessionId)
    await service.whenSettled(created.value.id)
    const review = service.getTask(created.value.id)!

    const rejected = await service.reject(
      { id: review.id, revision: review.revision },
      { feedback: 'Add an empty state.' },
    )

    expect(rejected.ok && rejected.value.status).toBe('running')
    expect(rejected.ok && rejected.value.currentSessionId).toBe(sessionId)
    expect(rejected.ok && rejected.value.rounds.map(round => round.trigger)).toEqual(['initial', 'revision'])
    expect(runtime.calls.map(call => call.method)).toEqual([
      'session.create',
      'session.prompt',
      'session.prompt',
    ])
  })

  it('appends follow-up prompts to the active round', async () => {
    const { runtime, service } = await harness()
    const created = await service.create(createRequest('Follow up'))
    if (!created.ok) throw new Error('test task creation failed')
    const started = await service.start({ id: created.value.id, revision: 0 })
    if (!started.ok) throw new Error('test task start failed')

    const followed = await service.followup(
      { id: started.value.id, revision: started.value.revision },
      { text: 'Also verify narrow screens.' },
    )

    expect(followed.ok && followed.value.rounds).toHaveLength(1)
    expect(followed.ok && followed.value.rounds[0]?.prompts).toHaveLength(2)
    expect(runtime.calls.map(call => call.method)).toEqual([
      'session.create',
      'session.prompt',
      'session.prompt',
    ])
  })

  it('enters failed without automatic retry and retries only on explicit action', async () => {
    const { runtime, service } = await harness()
    const created = await service.create(createRequest('Retry work'))
    if (!created.ok) throw new Error('test task creation failed')
    const started = await service.start({ id: created.value.id, revision: 0 })
    if (!started.ok) throw new Error('test task start failed')
    const sessionId = started.value.currentSessionId!
    runtime.appendPromptTurn(sessionId, 0, {
      kind: 'error',
      error: { code: 'MODEL_ERROR', message: 'model failed' },
    })
    runtime.setIdle(sessionId)
    await service.whenSettled(created.value.id)
    const failed = service.getTask(created.value.id)!

    expect(failed.status).toBe('failed')
    expect(failed.rounds).toHaveLength(1)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(service.getTask(created.value.id)?.rounds).toHaveLength(1)

    const retried = await service.retry(
      { id: failed.id, revision: failed.revision },
      { allowFreshSession: false },
    )
    expect(retried.ok && retried.value.rounds).toHaveLength(2)
    expect(retried.ok && retried.value.currentSessionId).toBe(sessionId)
  })

  it('requires explicit permission before retrying in a fresh Session', async () => {
    const { runtime, service } = await harness()
    const created = await service.create(createRequest('Fresh retry'))
    if (!created.ok) throw new Error('test task creation failed')
    const started = await service.start({ id: created.value.id, revision: 0 })
    if (!started.ok) throw new Error('test task start failed')
    const sessionId = started.value.currentSessionId!
    runtime.appendPromptTurn(sessionId, 0, { kind: 'blocked' })
    runtime.setIdle(sessionId)
    await service.whenSettled(created.value.id)
    const failed = service.getTask(created.value.id)!
    runtime.removeLiveAgent(sessionId)

    const required = await service.retry(
      { id: failed.id, revision: failed.revision },
      { allowFreshSession: false },
    )
    expect(required).toEqual({
      ok: false,
      error: { code: 'fresh-session-required', sessionId },
    })
    expect(service.getTask(created.value.id)?.rounds).toHaveLength(1)

    const fresh = await service.retry(
      { id: failed.id, revision: failed.revision },
      { allowFreshSession: true },
    )
    expect(fresh.ok && fresh.value.currentSessionId).not.toBe(sessionId)
    expect(runtime.calls.filter(call => call.method === 'session.create')).toHaveLength(2)
  })

  it('stops an active turn and reconciles the aborted round to failed', async () => {
    const { service } = await harness()
    const created = await service.create(createRequest('Stop work'))
    if (!created.ok) throw new Error('test task creation failed')
    const started = await service.start({ id: created.value.id, revision: 0 })
    if (!started.ok) throw new Error('test task start failed')

    const stopped = await service.stop({ id: started.value.id, revision: started.value.revision })
    expect(stopped.ok && stopped.value.status).toBe('failed')
    expect(stopped.ok && stopped.value.rounds[0]?.status).toBe('cancelled')
  })
})

describe('TaskBoardService validation and defensive paths', () => {
  it('rejects invalid deployment limits and access before initialization', async () => {
    const invalidContext = new Context()
    expect(() => new TaskBoardService(invalidContext, {
      ...TEST_CONFIG,
      maxTitleBytes: 0,
    })).toThrow(/maxTitleBytes must be a positive safe integer/)
    await invalidContext.fiber.dispose()

    const context = new Context()
    const service = new TaskBoardService(context, TEST_CONFIG)
    await expect(service.snapshot()).rejects.toThrow(/service is not initialized/)
    expect(() => service.currentBoardRevision()).toThrow(/service is not initialized/)
    expect(() => service.getTask('missing' as TaskBoardTaskId)).toThrow(/service is not initialized/)
    await context.fiber.dispose()
  })

  it('validates all create and edit text limits before mutation', async () => {
    const { service } = await harness({
      config: {
        maxTitleBytes: 3,
        maxDescriptionBytes: 4,
        maxAcceptanceCriteriaBytes: 4,
        maxFollowupBytes: 4,
        maxFeedbackBytes: 4,
      },
    })

    await expect(service.create({
      ...createRequest('ok'),
      workspaceId: 'workspace-1' as never,
      cwd: '/tmp/project',
    })).resolves.toMatchObject({ ok: false, error: { code: 'invalid-request', field: 'cwd' } })
    await expect(service.create({ ...createRequest('ok'), title: 'four' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-request', field: 'title' },
    })
    await expect(service.create(createRequest('12345'))).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-request', field: 'description' },
    })
    await expect(service.create({
      ...createRequest('ok'),
      acceptanceCriteria: '12345',
    })).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-request', field: 'acceptanceCriteria' },
    })
    await expect(service.create(createRequest('   '))).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-request', field: 'description' },
    })

    const created = await service.create(createRequest('1234'))
    if (!created.ok) throw new Error('test task creation failed')
    const ref = { id: created.value.id, revision: created.value.revision }
    await expect(service.edit(ref, {
      workspaceId: 'workspace-2' as never,
      cwd: '/tmp/project',
    })).resolves.toMatchObject({ ok: false, error: { code: 'invalid-request', field: 'cwd' } })
    await expect(service.edit(ref, { title: 'four' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-request', field: 'title' },
    })
    await expect(service.edit(ref, { description: '12345' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-request', field: 'description' },
    })
    await expect(service.edit(ref, { acceptanceCriteria: '12345' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-request', field: 'acceptanceCriteria' },
    })
    await expect(service.edit(ref, { description: ' ', acceptanceCriteria: ' ' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-request', field: 'description' },
    })
    await expect(service.edit(ref, { title: 'ok', resetAutomaticTitle: true })).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-request', field: 'patch' },
    })
    await expect(service.followup(ref, { text: ' ' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-request', field: 'text' },
    })
    await expect(service.followup(ref, { text: '12345' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-request', field: 'text' },
    })
    await expect(service.reject(ref, { feedback: '12345' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-request', field: 'feedback' },
    })
  })

  it('returns stable failures for every invalid workflow action', async () => {
    const { service } = await harness()
    const created = await service.create(createRequest('Transitions'))
    if (!created.ok) throw new Error('test task creation failed')
    const taskId = created.value.id
    const ref = { id: taskId, revision: created.value.revision }
    const missing = { id: 'missing-task' as TaskBoardTaskId, revision: 0 }

    await expect(service.reorder(missing, {})).resolves.toMatchObject({
      ok: false,
      error: { code: 'task-not-found' },
    })
    await expect(service.reorder(ref, { beforeTaskId: 'missing-anchor' as TaskBoardTaskId })).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-request', field: 'beforeTaskId' },
    })
    await expect(service.start({ id: taskId, revision: 99 })).resolves.toMatchObject({
      ok: false,
      error: { code: 'revision-conflict' },
    })
    await expect(service.followup(ref, { text: 'Later' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-transition', operation: 'followup' },
    })
    await expect(service.reject(ref, { feedback: 'No' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-transition', operation: 'reject' },
    })
    await expect(service.retry(ref, { allowFreshSession: false })).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-transition', operation: 'retry' },
    })
    await expect(service.retry(missing, { allowFreshSession: false })).resolves.toMatchObject({
      ok: false,
      error: { code: 'task-not-found' },
    })
    await expect(service.stop(ref)).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-transition', operation: 'stop' },
    })
    await expect(service.approve(ref)).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-transition', operation: 'approve' },
    })
    await expect(service.reopen(ref)).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-transition', operation: 'reopen' },
    })

    const started = await service.start(ref)
    if (!started.ok) throw new Error('test task start failed')
    await expect(service.edit({ id: taskId, revision: started.value.revision }, { title: 'Blocked' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-request', field: 'patch' },
    })
    await expect(service.delete({ id: taskId, revision: started.value.revision })).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-transition', operation: 'delete' },
    })
  })
})

describe('TaskBoardService provider and recovery failures', () => {
  it('normalizes rejected and thrown Session creation or prompt admission', async () => {
    const { runtime, service } = await harness()
    const createRejected = await service.create(createRequest('Create rejected'))
    if (!createRejected.ok) throw new Error('test task creation failed')
    runtime.nextCreateError = {
      code: 'agent-preset-not-found',
      message: 'missing preset',
      details: { agentPreset: 'missing', available: [] },
    }
    await expect(service.start({ id: createRejected.value.id, revision: 0 })).resolves.toMatchObject({
      ok: false,
      error: { code: 'prompt-rejected', failure: { stage: 'session-create', code: 'agent-preset-not-found' } },
    })

    const createThrew = await service.create(createRequest('Create threw'))
    if (!createThrew.ok) throw new Error('test task creation failed')
    runtime.nextCreateThrow = new Error('transport closed')
    await expect(service.start({ id: createThrew.value.id, revision: 0 })).resolves.toMatchObject({
      ok: false,
      error: { code: 'prompt-rejected', failure: { stage: 'session-create', code: 'SESSION_CREATE_FAILED' } },
    })

    const promptThrew = await service.create(createRequest('Prompt threw'))
    if (!promptThrew.ok) throw new Error('test task creation failed')
    runtime.nextPromptThrow = new Error('transport closed')
    await expect(service.start({ id: promptThrew.value.id, revision: 0 })).resolves.toMatchObject({
      ok: false,
      error: { code: 'prompt-rejected', failure: { stage: 'prompt-admission', code: 'PROMPT_ADMISSION_FAILED' } },
    })
  })

  it('reads named and unnamed attachments and restores state when a read fails', async () => {
    const { runtime, service } = await harness()
    const named = await service.uploadAttachment({
      mediaType: 'image/png',
      data: 'aGVsbG8=',
      name: 'named.png',
    })
    const unnamed = await service.uploadAttachment({ mediaType: 'image/png', data: 'd29ybGQ=' })
    if (!named.ok || !unnamed.ok) throw new Error('test attachment upload failed')

    const created = await service.create({
      ...createRequest('Attachment prompt'),
      workspaceId: 'workspace-attachment' as never,
      agentPreset: 'coding',
      attachments: [named.value, unnamed.value],
    })
    if (!created.ok) throw new Error('test task creation failed')
    const started = await service.start({ id: created.value.id, revision: 0 })
    expect(started.ok && started.value.status).toBe('running')
    const promptCall = runtime.calls.find(call => call.method === 'session.prompt')
    expect(promptCall).toMatchObject({
      request: {
        payload: {
          content: [
            { type: 'text' },
            { type: 'image', name: 'named.png' },
            { type: 'image' },
          ],
        },
      },
    })

    const readFailed = await service.create({
      ...createRequest('Attachment read failure'),
      attachments: [named.value],
    })
    if (!readFailed.ok) throw new Error('test task creation failed')
    runtime.nextAttachmentReadError = new Error('object missing')
    await expect(service.start({ id: readFailed.value.id, revision: 0 })).resolves.toMatchObject({
      ok: false,
      error: { code: 'prompt-rejected', failure: { code: 'ATTACHMENT_READ_FAILED' } },
    })
    expect(service.getTask(readFailed.value.id)?.status).toBe('initialized')
  })

  it('rolls back follow-up prompts for provider errors and thrown transports', async () => {
    const { runtime, service } = await harness()
    const created = await service.create(createRequest('Follow-up failures'))
    if (!created.ok) throw new Error('test task creation failed')
    const started = await service.start({ id: created.value.id, revision: 0 })
    if (!started.ok) throw new Error('test task start failed')

    runtime.nextPromptError = { code: 'agent-busy', message: 'busy', details: { reason: 'running' } }
    await expect(service.followup(
      { id: started.value.id, revision: started.value.revision },
      { text: 'Rejected follow-up' },
    )).resolves.toMatchObject({ ok: false, error: { code: 'prompt-rejected' } })
    const afterRejected = service.getTask(created.value.id)!
    expect(afterRejected.rounds[0]?.prompts).toHaveLength(1)

    runtime.nextPromptThrow = new Error('transport closed')
    await expect(service.followup(
      { id: afterRejected.id, revision: afterRejected.revision },
      { text: 'Thrown follow-up' },
    )).resolves.toMatchObject({
      ok: false,
      error: { code: 'prompt-rejected', failure: { code: 'PROMPT_ADMISSION_FAILED' } },
    })
    expect(service.getTask(created.value.id)?.rounds[0]?.prompts).toHaveLength(1)
  })

  it('normalizes cancellation errors without losing the running task', async () => {
    const { runtime, service } = await harness()
    const first = await service.create(createRequest('Cancel rejected'))
    if (!first.ok) throw new Error('test task creation failed')
    const firstStarted = await service.start({ id: first.value.id, revision: 0 })
    if (!firstStarted.ok) throw new Error('test task start failed')
    runtime.nextCancelError = { code: 'agent-busy', message: 'busy', details: { reason: 'running' } }
    await expect(service.stop({ id: firstStarted.value.id, revision: firstStarted.value.revision })).resolves.toMatchObject({
      ok: false,
      error: { code: 'session-unavailable', sessionId: firstStarted.value.currentSessionId },
    })

    const second = await service.create(createRequest('Cancel threw'))
    if (!second.ok) throw new Error('test task creation failed')
    const secondStarted = await service.start({ id: second.value.id, revision: 0 })
    if (!secondStarted.ok) throw new Error('test task start failed')
    runtime.nextCancelThrow = new Error('transport closed')
    await expect(service.stop({ id: secondStarted.value.id, revision: secondStarted.value.revision })).resolves.toMatchObject({
      ok: false,
      error: { code: 'session-unavailable', sessionId: secondStarted.value.currentSessionId },
    })
    expect(service.getTask(second.value.id)?.status).toBe('running')
  })
})

describe('TaskBoardService reconciliation edges', () => {
  it('reopens an approved task while retaining its Session history', async () => {
    const { runtime, service } = await harness()
    const created = await service.create(createRequest('Reopen work'))
    if (!created.ok) throw new Error('test task creation failed')
    const started = await service.start({ id: created.value.id, revision: 0 })
    if (!started.ok) throw new Error('test task start failed')
    const sessionId = started.value.currentSessionId!
    runtime.appendPromptTurn(sessionId, 0, { kind: 'completed' })
    runtime.setIdle(sessionId)
    await service.whenSettled(created.value.id)
    const review = service.getTask(created.value.id)!
    const approved = await service.approve({ id: review.id, revision: review.revision })
    if (!approved.ok) throw new Error('test task approval failed')
    const reopened = await service.reopen({ id: approved.value.id, revision: approved.value.revision })
    expect(reopened).toMatchObject({
      ok: true,
      value: { status: 'initialized', rounds: [{ sessionId }] },
    })
  })

  it.each([
    [{ kind: 'max-tokens' } as const, 'MAX_TOKENS'],
    [{ kind: 'interrupted' } as const, 'INTERRUPTED'],
    [{ kind: 'provider-extension' } as never, 'UNKNOWN_TURN_END'],
  ])('maps terminal reason %o to stable failure %s', async (reason, code) => {
    const { runtime, service } = await harness()
    const created = await service.create(createRequest(`Terminal ${code}`))
    if (!created.ok) throw new Error('test task creation failed')
    const started = await service.start({ id: created.value.id, revision: 0 })
    if (!started.ok) throw new Error('test task start failed')
    const sessionId = started.value.currentSessionId!
    runtime.appendPromptTurn(sessionId, 0, reason)
    runtime.setIdle(sessionId)
    await service.whenSettled(created.value.id)
    expect(service.getTask(created.value.id)).toMatchObject({
      status: 'failed',
      rounds: [{ failure: { code } }],
    })
  })

  it('reconciles from persistence when no live Agent remains', async () => {
    const { runtime, service } = await harness()
    const created = await service.create(createRequest('Persisted reconciliation'))
    if (!created.ok) throw new Error('test task creation failed')
    const started = await service.start({ id: created.value.id, revision: 0 })
    if (!started.ok) throw new Error('test task start failed')
    const sessionId = started.value.currentSessionId!
    runtime.removeLiveAgent(sessionId)
    runtime.appendPromptTurn(sessionId, 0, { kind: 'completed' })
    await service.whenSettled(created.value.id)
    expect(service.getTask(created.value.id)?.status).toBe('review')
  })

  it('fails closed when persisted Session history cannot be inspected', async () => {
    const { runtime, service } = await harness()
    const created = await service.create(createRequest('Missing history'))
    if (!created.ok) throw new Error('test task creation failed')
    const started = await service.start({ id: created.value.id, revision: 0 })
    if (!started.ok) throw new Error('test task start failed')
    const sessionId = started.value.currentSessionId!
    runtime.removeLiveAgent(sessionId)
    runtime.nextInspectError = new Error('history unavailable')
    runtime.appendPromptTurn(sessionId, 0, { kind: 'completed' })
    await service.whenSettled(created.value.id)
    expect(service.getTask(created.value.id)).toMatchObject({
      status: 'failed',
      rounds: [{ failure: { stage: 'recovery', code: 'SESSION_HISTORY_UNAVAILABLE' } }],
    })
  })

  it('ignores unrelated Agent events and rejects new work after disposal', async () => {
    const value = await setupTaskBoard()
    active.push(value)
    expect(() => {
      value.ctx.emit('agent/status', {
        agent: { id: SessionId('unrelated-session') } as never,
        status: 'idle',
      })
    }).not.toThrow()
    await value.dispose()
    active.splice(active.indexOf(value), 1)

    await expect(value.service.snapshot()).rejects.toThrow(/service is disposing/)
    await expect(value.service.edit({ id: 'missing' as TaskBoardTaskId, revision: 0 }, {
      title: 'After dispose',
    })).rejects.toThrow(/service is disposing/)
  })
})

describe('TaskBoardService lifecycle and defensive paths', () => {
  it('rejects empty attachment data before storage', async () => {
    const { runtime, service } = await harness()

    await expect(service.uploadAttachment({ mediaType: 'image/png', data: '' })).resolves.toEqual({
      ok: false,
      error: {
        code: 'invalid-request',
        field: 'attachment',
        message: 'Image upload must use canonical base64.',
      },
    })
    expect(runtime.savedImages).toEqual([])
  })

  it('derives an omitted title, forwards cwd, and settles an idle identity', async () => {
    const { runtime, service } = await harness()
    const created = await service.create({
      description: 'Run the workspace checks',
      acceptanceCriteria: '',
      cwd: '/tmp/task-board-workspace',
      start: true,
    })
    if (!created.ok) throw new Error('test task creation failed')

    expect(created.value.title).toBe('Run the workspace checks')
    expect(runtime.calls.find(call => call.method === 'session.create')?.request.payload).toMatchObject({
      cwd: '/tmp/task-board-workspace',
    })
    await expect(service.whenSettled('never-enqueued' as TaskBoardTaskId)).resolves.toBeUndefined()
  })

  it('reconciles active persisted work during service initialization', async () => {
    const value = await harness()
    const created = await value.service.create(createRequest('Recover after service restart'))
    if (!created.ok) throw new Error('test task creation failed')
    const started = await value.service.start({ id: created.value.id, revision: created.value.revision })
    if (!started.ok) throw new Error('test task start failed')
    const currentSessionId = started.value.currentSessionId!

    await value.fiber.dispose()
    value.runtime.appendPromptTurn(currentSessionId, 0, { kind: 'completed' })
    value.runtime.setIdle(currentSessionId)
    await value.ctx.plugin(TaskBoardService, TEST_CONFIG)

    const restarted = value.ctx.taskBoard
    await restarted.whenSettled(created.value.id)
    expect(restarted.getTask(created.value.id)?.status).toBe('review')
  })

  it('ignores unmatched Session evidence before projecting the admitted prompt', async () => {
    const { runtime, service } = await harness()
    const created = await service.create(createRequest('Ignore unmatched evidence'))
    if (!created.ok) throw new Error('test task creation failed')
    const started = await service.start({ id: created.value.id, revision: created.value.revision })
    if (!started.ok) throw new Error('test task start failed')
    const currentSessionId = started.value.currentSessionId!

    runtime.appendUnmatchedEvidence(currentSessionId, 0)
    runtime.appendPromptTurn(currentSessionId, 0, { kind: 'completed' })
    runtime.setIdle(currentSessionId)
    await service.whenSettled(created.value.id)

    expect(service.getTask(created.value.id)?.status).toBe('review')
  })

  it('returns stable transition failures for cards that retain a Session', async () => {
    const { runtime, service } = await harness()
    const missingRef = { id: 'missing-transition-task' as TaskBoardTaskId, revision: 0 }
    await expect(service.followup(missingRef, { text: 'missing' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'task-not-found' },
    })
    await expect(service.approve(missingRef)).resolves.toMatchObject({
      ok: false,
      error: { code: 'task-not-found' },
    })
    const created = await service.create(createRequest('Review transition failures'))
    if (!created.ok) throw new Error('test task creation failed')
    const started = await service.start({ id: created.value.id, revision: created.value.revision })
    if (!started.ok) throw new Error('test task start failed')
    const currentSessionId = started.value.currentSessionId!
    runtime.appendPromptTurn(currentSessionId, 0, { kind: 'completed' })
    runtime.setIdle(currentSessionId)
    await service.whenSettled(created.value.id)
    const review = service.getTask(created.value.id)
    if (review === undefined) throw new Error('test task reconciliation failed')
    const reviewRef = { id: review.id, revision: review.revision }

    await expect(service.start(reviewRef)).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-transition', operation: 'start' },
    })
    await expect(service.followup(reviewRef, { text: 'not while reviewing' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-transition', operation: 'followup' },
    })
    await expect(service.stop(reviewRef)).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-transition', operation: 'stop' },
    })

    const approved = await service.approve(reviewRef)
    if (!approved.ok) throw new Error('test task approval failed')
    await expect(service.reject(
      { id: approved.value.id, revision: approved.value.revision },
      { feedback: 'not after approval' },
    )).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-transition', operation: 'reject' },
    })
  })

  it('propagates unexpected state mutation failures without consuming revisions', async () => {
    const { runtime, service } = await harness()
    const created = await service.create(createRequest('Unexpected mutation failures'))
    if (!created.ok) throw new Error('test task creation failed')
    const ref = { id: created.value.id, revision: created.value.revision }

    const expectClockFailure = async (operation: () => Promise<unknown>) => {
      const error = new Error('clock unavailable')
      const clock = vi.spyOn(Date, 'now').mockImplementationOnce(() => { throw error })
      try {
        await expect(operation()).rejects.toBe(error)
      } finally {
        clock.mockRestore()
      }
    }

    await expectClockFailure(() => service.edit(ref, { title: 'Edited' }))
    await expectClockFailure(() => service.reorder(ref, {}))
    await expectClockFailure(() => service.start(ref))
    expect(service.getTask(created.value.id)?.revision).toBe(created.value.revision)

    const started = await service.start(ref)
    if (!started.ok) throw new Error('test task start failed')
    const currentSessionId = started.value.currentSessionId!
    runtime.appendPromptTurn(currentSessionId, 0, { kind: 'completed' })
    runtime.setIdle(currentSessionId)
    await service.whenSettled(created.value.id)
    const review = service.getTask(created.value.id)
    if (review === undefined) throw new Error('test task reconciliation failed')
    await expectClockFailure(() => service.approve({ id: review.id, revision: review.revision }))
    expect(service.getTask(created.value.id)?.status).toBe('review')
  })

  it('fails loudly when ordering or durable table results violate service assumptions', async () => {
    const first = await harness()
    const overflowSequence = Math.floor(Number.MAX_SAFE_INTEGER / 1_000_000) + 1
    await boardGlobal(first.service).set({ nextSequence: overflowSequence, boardRevision: 0 })
    await expect(first.service.create(createRequest('Overflow ordering'))).rejects.toThrow(
      /sequence exceeds ordering range/,
    )

    const second = await harness()
    const created = await second.service.create(createRequest('Durable contradictions'))
    const anchor = await second.service.create(createRequest('Durable anchor'))
    if (!created.ok || !anchor.ok) throw new Error('test task creation failed')
    const table = taskTable(second.service)
    const current = second.service.getTask(created.value.id)
    if (current === undefined) throw new Error('test task lookup failed')
    const get = vi.spyOn(table, 'get')
      .mockReturnValueOnce(current)
      .mockReturnValueOnce(undefined)
    try {
      await expect(second.service.reorder(
        { id: current.id, revision: current.revision },
        { beforeTaskId: anchor.value.id },
      )).rejects.toThrow(/reordered task .* disappeared/)
    } finally {
      get.mockRestore()
    }

    const remove = vi.spyOn(table, 'delete').mockResolvedValueOnce(false)
    try {
      await expect(second.service.delete({
        id: anchor.value.id,
        revision: anchor.value.revision,
      })).rejects.toThrow(/disappeared before deletion/)
    } finally {
      remove.mockRestore()
    }
    const getRequiredTask = Reflect.get(second.service, 'getRequiredTask') as (
      this: TaskBoardService,
      id: TaskBoardTaskId,
    ) => TaskBoardTask
    expect(() => getRequiredTask.call(second.service, 'missing-row' as TaskBoardTaskId)).toThrow(
      /task 'missing-row' disappeared/,
    )
  })

  it('logs asynchronous reconciliation storage failures and continues later attempts', async () => {
    const { ctx, runtime, service } = await harness()
    const created = await service.create(createRequest('Transient reconciliation storage failure'))
    if (!created.ok) throw new Error('test task creation failed')
    const started = await service.start({ id: created.value.id, revision: created.value.revision })
    if (!started.ok) throw new Error('test task start failed')
    const warning = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)
    const write = vi.spyOn(taskTable(service), 'put').mockRejectedValueOnce(new Error('disk unavailable'))
    try {
      runtime.appendPromptTurn(started.value.currentSessionId!, 0, { kind: 'completed' })
      runtime.setIdle(started.value.currentSessionId!)
      await service.whenSettled(created.value.id)
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('Session reconciliation failed'))
      expect(service.getTask(created.value.id)?.status).toBe('review')
    } finally {
      write.mockRestore()
      warning.mockRestore()
    }
  })

  it('keeps structurally incomplete running rows non-terminal', async () => {
    const { runtime, service } = await harness()
    const created = await service.create(createRequest('Incomplete running row'))
    if (!created.ok) throw new Error('test task creation failed')
    const started = await service.start({ id: created.value.id, revision: created.value.revision })
    if (!started.ok) throw new Error('test task start failed')
    const table = taskTable(service)

    await table.put(started.value.id, { ...started.value, rounds: [] })
    runtime.appendUnmatchedEvidence(started.value.currentSessionId!, 0)
    await service.whenSettled(started.value.id)
    expect(service.getTask(started.value.id)?.status).toBe('running')

    const round = started.value.rounds.at(-1)
    if (round === undefined) throw new Error('test task round missing')
    await table.put(started.value.id, {
      ...started.value,
      rounds: [{ ...round, prompts: [] }],
    })
    runtime.appendUnmatchedEvidence(started.value.currentSessionId!, 0)
    await service.whenSettled(started.value.id)
    expect(service.getTask(started.value.id)?.status).toBe('running')
  })

  it('rejects a retry when durable history still marks its latest round active', async () => {
    const { runtime, service } = await harness()
    const created = await service.create(createRequest('Malformed retry history'))
    if (!created.ok) throw new Error('test task creation failed')
    const started = await service.start({ id: created.value.id, revision: created.value.revision })
    if (!started.ok) throw new Error('test task start failed')
    runtime.appendPromptTurn(started.value.currentSessionId!, 0, {
      kind: 'error',
      error: { code: 'FAILED', message: 'failed' },
    })
    runtime.setIdle(started.value.currentSessionId!)
    await service.whenSettled(started.value.id)
    const failed = service.getTask(started.value.id)
    const round = failed?.rounds.at(-1)
    if (failed === undefined || round === undefined) throw new Error('test task failure missing')
    await taskTable(service).put(failed.id, {
      ...failed,
      rounds: [...failed.rounds.slice(0, -1), { ...round, status: 'running' }],
    })

    await expect(service.retry(
      { id: failed.id, revision: failed.revision },
      { allowFreshSession: true },
    )).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-transition', operation: 'retry' },
    })
  })

  it('honors already-running admission state and rejects a missing prepared Session', async () => {
    const runningValue = await harness()
    const runningCreated = await runningValue.service.create(createRequest('Already running admission'))
    if (!runningCreated.ok) throw new Error('test task creation failed')
    const runningTable = taskTable(runningValue.service)
    const originalRunningPut = runningTable.put.bind(runningTable)
    const runningPut = vi.spyOn(runningTable, 'put')
    runningPut.mockImplementationOnce(async (id, task) => {
      const round = task.rounds.at(-1)
      if (round === undefined) throw new Error('test task round missing')
      await originalRunningPut(id, {
        ...task,
        rounds: [...task.rounds.slice(0, -1), { ...round, status: 'running' }],
      })
    })
    const running = await runningValue.service.start({
      id: runningCreated.value.id,
      revision: runningCreated.value.revision,
    })
    runningPut.mockRestore()
    if (!running.ok) throw new Error('test task start failed')
    expect(running.value.rounds.at(-1)?.status).toBe('running')

    const missingValue = await harness()
    const missingCreated = await missingValue.service.create(createRequest('Missing prepared Session'))
    if (!missingCreated.ok) throw new Error('test task creation failed')
    const missingTable = taskTable(missingValue.service)
    const originalMissingPut = missingTable.put.bind(missingTable)
    const missingPut = vi.spyOn(missingTable, 'put').mockImplementationOnce(async (id, task) => {
      const { currentSessionId: _currentSessionId, ...withoutSession } = task
      await originalMissingPut(id, withoutSession)
    })
    try {
      await expect(missingValue.service.start({
        id: missingCreated.value.id,
        revision: missingCreated.value.revision,
      })).rejects.toThrow(/has no current Session/)
    } finally {
      missingPut.mockRestore()
    }
  })
})
