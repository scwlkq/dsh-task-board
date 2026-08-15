import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef, SaveImageAttachment } from '@deepseek-ai/dsh-attachment'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import Invariants from '@deepseek-ai/dsh-invariants'
import type { ApiProxy } from '@deepseek-ai/dsh-host-apiproxy'
import type { RpcError, RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import {
  SESSION_FORMAT_VERSION,
  Session,
  SessionId,
  type SessionId as SessionIdType,
  type TurnEndReason,
} from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import ApiProxyTaskBoardSessionGateway from '../src/host/session-apiproxy.ts'
import TaskBoardService, { type Config } from '../src/host/service.ts'
import * as TaskBoardInvariant from '../src/invariant.ts'

interface TestAgent {
  readonly id: SessionIdType
  readonly session: Session
  status: 'idle' | 'running'
  whenIdle(): Promise<void>
}

function rpcOk<T>(request: RpcRequest<unknown>, value: T) {
  return { rpcId: request.rpcId, result: { ok: true as const, value } }
}

function rpcError(request: RpcRequest<unknown>, error: RpcError) {
  return { rpcId: request.rpcId, result: { ok: false as const, error } }
}

/** Controllable ApiProxy with real Session records and event envelopes. */
class ControlledSessionRuntime {
  readonly sessions = new Map<SessionIdType, Session>()
  readonly agents = new Map<SessionIdType, TestAgent>()
  readonly savedImages: SaveImageAttachment[] = []
  private readonly storedImages = new Map<string, { ref: ImageAttachmentRef; data: Uint8Array }>()
  readonly calls: Array<{ readonly method: 'session.create' | 'session.prompt' | 'session.cancel'; readonly request: RpcRequest<unknown> }> = []
  nextCreateError: RpcError | undefined
  nextCreateThrow: unknown
  nextPromptError: RpcError | undefined
  nextPromptThrow: unknown
  nextCancelError: RpcError | undefined
  nextCancelThrow: unknown
  nextAttachmentError: unknown
  nextAttachmentReadError: unknown
  nextInspectError: unknown
  private readonly idleWaiters = new Map<SessionIdType, Array<() => void>>()
  private readonly promptRequests = new Map<SessionIdType, Array<RpcRequest<{
    sessionId: SessionIdType
    mode: 'queue' | 'steer'
    content: Array<{ type: 'text'; text: string } | { type: 'image'; mediaType: string; data: string; name?: string }>
  }>>>()

  readonly apiProxy: Pick<ApiProxy, 'sessions'>

  constructor(readonly ctx: Context) {
    this.apiProxy = {
      sessions: {
        create: async (request) => {
          this.calls.push({ method: 'session.create', request })
          if (this.nextCreateThrow !== undefined) {
            const error = this.nextCreateThrow
            this.nextCreateThrow = undefined
            throw error
          }
          if (this.nextCreateError !== undefined) {
            const error = this.nextCreateError
            this.nextCreateError = undefined
            return rpcError(request, error)
          }
          const id = request.payload.sessionId ?? SessionId(`session-test-${this.sessions.size + 1}`)
          const session = Session.create(id, [], {
            version: SESSION_FORMAT_VERSION,
            id,
            createdAt: Date.now(),
            cwd: request.payload.cwd ?? '/tmp',
          })
          this.sessions.set(id, session)
          const agent: TestAgent = {
            id,
            session,
            status: 'idle',
            whenIdle: () => this.waitForIdle(id),
          }
          this.agents.set(id, agent)
          return rpcOk(request, {
            sessionId: id,
            ...(request.payload.agentPreset === undefined ? {} : { agentPreset: request.payload.agentPreset }),
          })
        },
        prompt: async (request) => {
          this.calls.push({ method: 'session.prompt', request })
          if (this.nextPromptThrow !== undefined) {
            const error = this.nextPromptThrow
            this.nextPromptThrow = undefined
            throw error
          }
          if (this.nextPromptError !== undefined) {
            const error = this.nextPromptError
            this.nextPromptError = undefined
            return rpcError(request, error)
          }
          const agent = this.agents.get(request.payload.sessionId)
          if (agent === undefined) {
            return rpcError(request, {
              code: 'session-not-found',
              message: `session '${request.payload.sessionId}' is not live`,
              details: { sessionId: request.payload.sessionId },
            })
          }
          agent.status = 'running'
          const requests = this.promptRequests.get(request.payload.sessionId) ?? []
          requests.push(request)
          this.promptRequests.set(request.payload.sessionId, requests)
          return rpcOk(request, { accepted: true as const })
        },
        cancel: async (request) => {
          this.calls.push({ method: 'session.cancel', request })
          if (this.nextCancelThrow !== undefined) {
            const error = this.nextCancelThrow
            this.nextCancelThrow = undefined
            throw error
          }
          if (this.nextCancelError !== undefined) {
            const error = this.nextCancelError
            this.nextCancelError = undefined
            return rpcError(request, error)
          }
          const prompts = this.promptRequests.get(request.payload.sessionId) ?? []
          const latest = prompts.at(-1)
          if (latest === undefined) {
            return rpcError(request, {
              code: 'session-not-found',
              message: `session '${request.payload.sessionId}' has no prompt`,
              details: { sessionId: request.payload.sessionId },
            })
          }
          this.appendPromptTurn(request.payload.sessionId, prompts.length - 1, {
            kind: 'aborted',
            reason: { kind: 'user' },
          })
          this.setIdle(request.payload.sessionId)
          return rpcOk(request, { accepted: true as const })
        },
      } as ApiProxy['sessions'],
    }
  }

  install(): void {
    this.ctx.provide('apiProxy', this.apiProxy as ApiProxy)
    this.ctx.provide('sessions', {
      get: (id: SessionIdType) => this.agents.get(id)?.session,
      list: () => [...this.agents.values()].map(agent => agent.session),
    } as never)
    this.ctx.provide('agents', {
      get: (id: SessionIdType) => this.agents.get(id),
      list: () => [...this.agents.values()],
    } as never)
    this.ctx.provide('sessionPersistence', {
      inspect: async (id: SessionIdType) => {
        if (this.nextInspectError !== undefined) {
          const error = this.nextInspectError
          this.nextInspectError = undefined
          throw error
        }
        const session = this.sessions.get(id)
        if (session === undefined) throw new Error(`session '${id}' not found`)
        return { meta: session.header, events: session.events }
      },
      readFrom: async (id: SessionIdType, fromSeq: number) => {
        const session = this.sessions.get(id)
        if (session === undefined) throw new Error(`session '${id}' not found`)
        return { meta: session.header, events: session.events.filter(event => event.seq >= fromSeq) }
      },
      listSnapshots: async () => [...this.sessions.values()].map(session => ({ header: session.header })),
    } as never)
    this.ctx.provide('attachments', {
      imageLimits: {
        maxImageBytes: 5 * 1024 * 1024,
        maxImagesPerMessage: 20,
        maxMessageImageBytes: 100 * 1024 * 1024,
        maxImagePixels: 40_000_000,
        mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
      },
      saveImage: async (input: SaveImageAttachment) => {
        if (this.nextAttachmentError !== undefined) {
          const error = this.nextAttachmentError
          this.nextAttachmentError = undefined
          throw error
        }
        const data = new Uint8Array(input.data)
        const stored = { ...input, data }
        this.savedImages.push(stored)
        const ref: ImageAttachmentRef = {
          attachmentId: `test:image:${this.savedImages.length}` as never,
          mediaType: input.mediaType,
          bytes: data.byteLength,
          width: 1,
          height: 1,
          ...(input.name === undefined ? {} : { name: input.name }),
        }
        this.storedImages.set(String(ref.attachmentId), { ref, data })
        return ref
      },
      readImage: async (ref: ImageAttachmentRef) => {
        if (this.nextAttachmentReadError !== undefined) {
          const error = this.nextAttachmentReadError
          this.nextAttachmentReadError = undefined
          throw error
        }
        const stored = this.storedImages.get(String(ref.attachmentId))
        if (stored === undefined) throw new Error('test image attachment not found')
        return stored
      },
    } as never)
  }

  appendPromptTurn(sessionId: SessionIdType, promptIndex: number, reason: TurnEndReason): void {
    const session = this.sessions.get(sessionId)
    const request = this.promptRequests.get(sessionId)?.[promptIndex]
    if (session === undefined || request === undefined) throw new Error('unknown test prompt')
    const turn = promptIndex + 1
    const startEvent = session.append('turn/start', { turn })
    this.ctx.emit('session/event', session, startEvent)
    const text = request.payload.content.find(part => part.type === 'text')?.text ?? ''
    const messageEvent = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'user', rpcId: request.rpcId },
    }), { surfaceOp: 'append' })
    this.ctx.emit('session/event', session, messageEvent)
    const endEvent = session.append('turn/end', { turn, reason })
    this.ctx.emit('session/event', session, endEvent)
  }

  appendUnmatchedEvidence(sessionId: SessionIdType, promptIndex: number): void {
    const session = this.sessions.get(sessionId)
    const request = this.promptRequests.get(sessionId)?.[promptIndex]
    if (session === undefined || request === undefined) throw new Error('unknown test prompt')
    const messageEvent = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'unmatched evidence' }],
      source: { kind: 'user', rpcId: request.rpcId },
    }), { surfaceOp: 'append' })
    this.ctx.emit('session/event', session, messageEvent)
    const endEvent = session.append('turn/end', {
      turn: promptIndex + 10_000,
      reason: { kind: 'completed' },
    })
    this.ctx.emit('session/event', session, endEvent)
  }

  setIdle(sessionId: SessionIdType): void {
    const agent = this.agents.get(sessionId)
    if (agent === undefined) throw new Error(`unknown test Agent '${sessionId}'`)
    agent.status = 'idle'
    this.ctx.emit('agent/status', { agent: agent as never, status: 'idle' })
    for (const resolve of this.idleWaiters.get(sessionId) ?? []) resolve()
    this.idleWaiters.delete(sessionId)
  }

  removeLiveAgent(sessionId: SessionIdType): void {
    this.agents.delete(sessionId)
  }

  private waitForIdle(sessionId: SessionIdType): Promise<void> {
    if (this.agents.get(sessionId)?.status === 'idle') return Promise.resolve()
    return new Promise((resolve) => {
      const waiters = this.idleWaiters.get(sessionId) ?? []
      waiters.push(resolve)
      this.idleWaiters.set(sessionId, waiters)
    })
  }
}

export const TEST_CONFIG: Config = {
  automaticTitleMaxChars: 80,
  maxTitleBytes: 512,
  maxDescriptionBytes: 32_768,
  maxAcceptanceCriteriaBytes: 16_384,
  maxFeedbackBytes: 16_384,
  maxFollowupBytes: 16_384,
}

/** Boot task-board service over the real JSON Storage Domain. */
export async function setupTaskBoard(options: {
  readonly config?: Partial<Config>
  readonly invariants?: boolean
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-task-board-test-'))
  const ctx = new Context()
  const runtime = new ControlledSessionRuntime(ctx)
  try {
    runtime.install()
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root })
    await ctx.plugin(StorageDomain, { backend: 'json' })
    await ctx.plugin(ApiProxyTaskBoardSessionGateway)
    if (options.invariants === true) await ctx.plugin(Invariants, { enabled: true })
    const fiber = await ctx.plugin(TaskBoardService, { ...TEST_CONFIG, ...options.config })
    if (options.invariants === true) await ctx.plugin(TaskBoardInvariant)
    return {
      ctx,
      fiber,
      service: ctx.taskBoard,
      runtime,
      root,
      async dispose() {
        await ctx.fiber.dispose()
        await rm(root, { recursive: true, force: true })
      },
    }
  } catch (error) {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
    throw error
  }
}
