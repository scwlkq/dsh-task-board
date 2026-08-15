import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry, type IWorkspaces } from '@deepseek-ai/dsh-client-runtime/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import type { IApiClient } from '@deepseek-ai/dsh-client-connection/client'
import type { TaskBoardSnapshotResult } from '../src/types.ts'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { TaskBoardLauncher } from '../src/client/TaskBoardLauncher.tsx'
import { TaskBoardOverlay } from '../src/client/TaskBoardOverlay.tsx'
import type { TaskBoardInjected } from '../src/client/slots.ts'
import type { TaskBoardRemote } from '../src/client/controller.ts'
import { apply, inject } from '../src/client/index.ts'

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
  const forwarded = new TestRemote(ctx) as TestRemote & { taskBoard: TaskBoardRemote }
  forwarded.taskBoard = taskBoardRemote()
  const unmountRemote = vi.fn(async () => {})
  const mountRemote = vi.spyOn(forwarded, '$mount').mockResolvedValue(unmountRemote)
  const sessions = { open: vi.fn() }
  ctx.provide('sessions', sessions as never)
  const workspaces = { pickDirectory: vi.fn<IWorkspaces['pickDirectory']>(async () => null) }
  ctx.provide('workspaces', workspaces as never)
  const agentPresets = vi.fn<IApiClient['agentPresets']['list']>(async () => ({
    rpcId: 'presets' as never,
    result: { ok: true as const, value: { presets: [], authorable: false, hasDocument: false } },
  }))
  const history = vi.fn<IApiClient['sessions']['history']>(async () => ({
    rpcId: 'history' as never,
    result: { ok: true as const, value: { events: [], hasMore: false } },
  }))
  const connection = {
    api: {
      agentPresets: { list: agentPresets },
      sessions: { history },
    },
  }
  ctx.provide('connection', connection as never)
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
    connection,
    ctx,
    fiber,
    forwarded,
    history,
    locale,
    mountRemote,
    sessions,
    slots,
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
    const read = b.forwarded.taskBoard.snapshot as ReturnType<typeof vi.fn>
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
      rpcId: 'presets-populated' as never,
      result: {
        ok: true as const,
        value: {
          presets: [
            { id: 'standard', trust: 'system' as const, isDefault: true, name: 'Standard', description: 'Default preset' },
            { id: 'minimal', trust: 'user' as const, isDefault: false },
            { id: 'broken', trust: 'user' as const, isDefault: false, broken: 'invalid config' },
          ],
          authorable: false,
          hasDocument: true,
        },
      },
    })
    b.workspaces.pickDirectory.mockResolvedValueOnce('/tmp/workspace')

    await expect(face.loadAgentPresets()).resolves.toEqual([
      { id: 'standard', isDefault: true, name: 'Standard', description: 'Default preset' },
      { id: 'minimal', isDefault: false },
    ])
    await expect(face.pickDirectory()).resolves.toBe('/tmp/workspace')
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

    expect(b.forwarded.taskBoard.uploadAttachment).toHaveBeenCalledOnce()
    expect(b.forwarded.taskBoard.create).toHaveBeenCalledOnce()
    expect(b.history).toHaveBeenCalledOnce()
    expect(b.sessions.open).toHaveBeenCalledWith('session-1')
  })

  it('surfaces Agent Preset list failures', async () => {
    const b = await bench()
    const face = b.slots.entries('shell.overlay')[0]!.inject?.() as unknown as TaskBoardInjected
    b.agentPresets.mockResolvedValueOnce({
      rpcId: 'presets-error' as never,
      result: {
        ok: false as const,
        error: { code: 'bad-request', message: 'Preset document is invalid.', details: { issues: [] } },
      },
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
