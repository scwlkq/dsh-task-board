import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { TaskBoardSnapshotResult } from '../src/types.ts'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { TaskBoardLauncher } from '../src/client/TaskBoardLauncher.tsx'
import { TaskBoardOverlay } from '../src/client/TaskBoardOverlay.tsx'
import type { TaskBoardInjected } from '../src/client/slots.ts'
import type { TaskBoardRemote } from '../src/client/controller.ts'
import { apply, inject } from '../src/client/index.ts'

class TracedRemote extends Service {
  constructor(ctx: Context) {
    super(ctx, 'remote')
  }

  agentPresets = { list: vi.fn() }
  session = { page: vi.fn() }
  directoryPicker = { pick: vi.fn() }

  async $mount(): Promise<() => Promise<void>> {
    return async () => {}
  }
}

function snapshot(boardRevision = 0): RemoteResult<TaskBoardSnapshotResult> {
  return { ok: true, value: { ok: true, value: { boardRevision, tasks: [] } } }
}

function taskBoardRemote(): TaskBoardRemote {
  const invalid = async () => ({
    ok: true as const,
    value: {
      ok: false as const,
      error: { code: 'invalid-transition' as const, status: 'initialized' as const, operation: 'test' },
    },
  })
  return {
    snapshot: vi.fn(async () => snapshot()),
    uploadAttachment: vi.fn(invalid),
    create: vi.fn(invalid),
    edit: vi.fn(invalid),
    reorder: vi.fn(invalid),
    start: vi.fn(invalid),
    followup: vi.fn(invalid),
    approve: vi.fn(invalid),
    reject: vi.fn(invalid),
    retry: vi.fn(invalid),
    stop: vi.fn(invalid),
    reopen: vi.fn(invalid),
    delete: vi.fn(async () => ({
      ok: true as const,
      value: {
        ok: false as const,
        error: { code: 'invalid-transition' as const, status: 'initialized' as const, operation: 'delete' },
      },
    })),
  }
}

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  const forwarded = new TracedRemote(ctx)
  const taskBoard = taskBoardRemote()
  const unmountRemote = vi.fn(async () => {})
  const mountRemote = vi.spyOn(forwarded, '$mount').mockImplementation(async () => {
    const namespace = ctx.plugin({
      name: 'remote.taskBoard',
      apply(scope) {
        scope.provide('remote.taskBoard', taskBoard)
      },
    })
    await namespace
    unmountRemote.mockImplementationOnce(async () => { await namespace.dispose() })
    return unmountRemote
  })
  const sessions = { retain: vi.fn() }
  ctx.provide('sessions', sessions as never)
  // 0.1.7-rc.2: ctx.workspaces.list is a bare observable source; the overlay
  // projects its snapshot items. Provide an empty ready list for the harness.
  const workspaceSnapshot = vi.fn(() => ({ items: [] as readonly WorkspaceView[], state: 'ready', phase: 'ready', error: null, archivedSessionIds: [], pinnedSessionIds: [] }))
  const workspaces = { list: { getSnapshot: workspaceSnapshot, subscribe: () => () => {} } }
  ctx.provide('workspaces', workspaces as never)
  // Declared by `inject` for harness parity; the port no longer reads this seam.
  ctx.provide('connection', {} as never)
  const agentPresets = vi.fn(async () => ({
    ok: true as const,
    value: { presets: [] },
  }))
  const sessionPage = vi.fn(async () => ({
    ok: true as const,
    value: { records: [], hasMore: false },
  }))
  const directoryPicker = vi.fn(async () => ({
    ok: true as const,
    value: null,
  }))
  forwarded.agentPresets = { list: agentPresets }
  forwarded.session = { page: sessionPage }
  forwarded.directoryPicker = { pick: directoryPicker }
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: {
      sidebar: { kind: 'single', scope: 'root' },
      'shell.overlay': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
  slots.register({
    name: 'sidebar',
    children: {
      'sidebar.footer.action': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return {
    agentPresets,
    ctx,
    directoryPicker,
    fiber,
    forwarded,
    locale,
    mountRemote,
    sessionPage,
    sessions,
    slots,
    taskBoard,
    unmountRemote,
    workspaces,
  }
}

describe('ui-task-board browser plugin', () => {
  it('declares only the Client services it uses', () => {
    expect(inject).toEqual([
      'slots',
      'locale',
      'remote',
      'sessions',
      'workspaces',
      'connection',
    ])
  })

  it('registers a launcher and overlay with one shared root store', async () => {
    const b = await bench()
    const launcher = b.slots.entries('sidebar.footer.action')[0]
    const overlay = b.slots.entries('shell.overlay')[0]

    expect(launcher?.component).toBe(TaskBoardLauncher)
    expect(overlay?.component).toBe(TaskBoardOverlay)
    expect(launcher?.store).toBeDefined()
    expect(launcher?.store).toBe(overlay?.store)
    expect(launcher?.locale).toBe('taskBoard')
    expect(overlay?.locale).toBe('taskBoard')

    const launcherFace = launcher?.inject?.() as unknown as TaskBoardInjected
    const overlayFace = overlay?.inject?.() as unknown as TaskBoardInjected
    expect(launcherFace.hooks.board).toBe(overlayFace.hooks.board)
    expect(launcherFace.refresh).toBeTypeOf('function')
    expect(b.mountRemote).toHaveBeenCalledOnce()
  })

  it('polls authoritative snapshots and refreshes after connection reset', async () => {
    const b = await bench()
    const entry = b.slots.entries('shell.overlay')[0]!
    const face = entry.inject?.() as unknown as TaskBoardInjected
    const read = b.taskBoard.snapshot as ReturnType<typeof vi.fn>
    await face.refresh()
    read.mockResolvedValueOnce(snapshot(3))

    await new Promise(resolve => setTimeout(resolve, 1_050))
    await vi.waitFor(() => {
      expect(face.hooks.board.getSnapshot().boardRevision).toBe(3)
    })

    read.mockResolvedValueOnce(snapshot(4))
    b.ctx.emit('connection/reset')
    await vi.waitFor(() => {
      expect(face.hooks.board.getSnapshot().boardRevision).toBe(4)
    })
  })

  it('routes the complete injected business face and filters broken Agent Presets', async () => {
    const b = await bench()
    const entry = b.slots.entries('shell.overlay')[0]!
    const face = entry.inject?.() as unknown as TaskBoardInjected
    b.agentPresets.mockResolvedValueOnce({
      ok: true as const,
      value: {
        presets: [
          { id: 'standard', isDefault: true, name: 'Standard', description: 'Default preset' },
          { id: 'minimal', isDefault: false },
          { id: 'broken', isDefault: false, broken: 'invalid config' },
        ],
      },
    })

    await expect(face.loadAgentPresets()).resolves.toEqual([
      { id: 'standard', isDefault: true, name: 'Standard', description: 'Default preset' },
      { id: 'minimal', isDefault: false },
    ])
    await expect(face.pickDirectory()).resolves.toBeNull()
    await face.uploadAttachment({ mediaType: 'image/png', data: '' })
    await face.create({ title: '', description: 'Create', acceptanceCriteria: '', start: false })
    const missing = 'missing-task' as never
    await face.edit(missing, { title: 'Edit' })
    await face.reorder(missing, undefined)
    await face.start(missing)
    await face.followup(missing, 'Continue')
    await face.approve(missing)
    await face.reject(missing, 'Revise')
    await face.retry(missing, true)
    await face.stop(missing)
    await face.reopen(missing)
    await face.delete(missing)
    await face.loadRoundHistory({
      id: 'round-1',
      ordinal: 1,
      trigger: 'initial',
      status: 'completed',
      originStatus: 'initialized',
      sessionId: 'session-1',
      prompts: [],
      startedAt: 1,
    } as never)
    face.openSession('session-1' as never)

    expect(b.taskBoard.uploadAttachment).toHaveBeenCalledOnce()
    expect(b.taskBoard.create).toHaveBeenCalledOnce()
    expect(b.sessionPage).toHaveBeenCalledOnce()
    expect(b.sessions.retain).toHaveBeenCalledWith('session-1', { source: 'task-board' })
  })

  it('surfaces Agent Preset list failures', async () => {
    const b = await bench()
    const face = b.slots.entries('shell.overlay')[0]!.inject?.() as unknown as TaskBoardInjected
    b.agentPresets.mockResolvedValueOnce({
      ok: false as const,
      error: { code: 'bad-request', message: 'Preset document is invalid.', details: { issues: [] } },
    })

    await expect(face.loadAgentPresets()).rejects.toThrow('Preset document is invalid.')
  })

  it('withdraws both contributions when the owning fiber is disposed', async () => {
    const b = await bench()
    expect(b.slots.entries('sidebar.footer.action')).toHaveLength(1)
    expect(b.slots.entries('shell.overlay')).toHaveLength(1)

    await b.fiber.dispose()

    expect(b.slots.entries('sidebar.footer.action')).toEqual([])
    expect(b.slots.entries('shell.overlay')).toEqual([])
    expect(b.unmountRemote).toHaveBeenCalledOnce()
  })
})
