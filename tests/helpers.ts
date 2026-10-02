import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef, SaveImageAttachment } from '@deepseek-ai/dsh-attachment'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import Invariants from '@deepseek-ai/dsh-invariants'
import type {
  SessionCancelRequest,
  SessionCancelValue,
  SessionCreateRequest,
  SessionCreateValue,
  SessionPromptRequest,
  SessionPromptValue,
} from '@deepseek-ai/dsh-api-session-controller/types'
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

/** Business failure vocabulary exercised through the Session Controller. */
interface TestProviderError {
  readonly code: string
  readonly message: string
  readonly details?: Record<string, unknown>
}

/** Throw a RemoteError-shaped failure as rebuilt across the Remote wire. */
function providerError(error: TestProviderError): never {
  throw {
    code: error.code,
    message: error.message,
    details: error.details ?? {},
    isDSHRemoteError: true,
  } as never
}

/** Controllable ApiProxy with real Session records and event envelopes. */
class ControlledSessionRuntime {
  readonly sessions = new Map<SessionIdType, Session>()
  readonly agents = new Map<SessionIdType, TestAgent>()
  readonly savedImages: SaveImageAttachment[] = []
  private readonly storedImages = new Map<string, { ref: ImageAttachmentRef; data: Uint8Array }>()
  readonly calls: Array<{
    readonly method: 'session.create' | 'session.prompt' | 'session.cancel'
    readonly request: { readonly rpcId?: string; readonly payload: unknown }
  }> = []
  nextCreateError: TestProviderError | undefined
  nextCreateThrow: unknown
  nextPromptError: TestProviderError | undefined
  nextPromptThrow: unknown
  nextCancelError: TestProviderError | undefined
  nextCancelThrow: unknown
  nextAttachmentError: unknown
  nextAttachmentReadError: unknown
  nextInspectError: unknown
  private readonly idleWaiters = new Map<SessionIdType, Array<() => void>>()
  private readonly promptRequests = new Map<SessionIdType, Array<{
    readonly rpcId: string
    readonly payload: SessionPromptRequest
  }>>()

  readonly sessionController: {
    readonly create: (request: SessionCreateRequest) => Promise<SessionCreateValue>
    readonly prompt: (request: SessionPromptRequest, signal: AbortSignal) => Promise<SessionPromptValue>
    readonly cancel: (request: SessionCancelRequest) => SessionCancelValue
  }

  constructor(readonly ctx: Context) {
    this.sessionController = {
      create: async (request) => {
        this.calls.push({ method: 'session.create', request: { rpcId: undefined, payload: request } })
        if (this.nextCreateThrow !== undefined) {
          const error = this.nextCreateThrow
          this.nextCreateThrow = undefined
          throw error
        }
        if (this.nextCreateError !== undefined) {
          const error = this.nextCreateError
          this.nextCreateError = undefined
          providerError(error)
        }
        const id = request.sessionId ?? SessionId(`session-test-${this.sessions.size + 1}`)
        const session = Session.create(id, [], {
          version: SESSION_FORMAT_VERSION,
          id,
          createdAt: Date.now(),
          cwd: request.cwd ?? '/tmp',
          isSeeded: false,
        })
        this.sessions.set(id, session)
        const agent: TestAgent = {
          id,
          session,
          status: 'idle',
          whenIdle: () => this.waitForIdle(id),
        }
        this.agents.set(id, agent)
        return {
          sessionId: id,
          ...(request.agentPreset === undefined ? {} : { agentPreset: request.agentPreset }),
        }
      },
      prompt: async (request) => {
        this.calls.push({ method: 'session.prompt', request: { rpcId: request.requestId, payload: request } })
        if (this.nextPromptThrow !== undefined) {
          const error = this.nextPromptThrow
          this.nextPromptThrow = undefined
          throw error
        }
        if (this.nextPromptError !== undefined) {
          const error = this.nextPromptError
          this.nextPromptError = undefined
          providerError(error)
        }
        const agent = this.agents.get(request.sessionId)
        if (agent === undefined) {
          providerError({
            code: 'session-not-found',
            message: `session '${request.sessionId}' is not live`,
            details: { sessionId: request.sessionId },
          })
        }
        agent.status = 'running'
        const requests = this.promptRequests.get(request.sessionId) ?? []
        requests.push({ rpcId: request.requestId, payload: request })
        this.promptRequests.set(request.sessionId, requests)
        return { accepted: true as const }
      },
      cancel: (request) => {
        this.calls.push({ method: 'session.cancel', request: { rpcId: undefined, payload: request } })
        if (this.nextCancelThrow !== undefined) {
          const error = this.nextCancelThrow
          this.nextCancelThrow = undefined
          throw error
        }
        if (this.nextCancelError !== undefined) {
          const error = this.nextCancelError
          this.nextCancelError = undefined
          providerError(error)
        }
        const prompts = this.promptRequests.get(request.sessionId) ?? []
        const latest = prompts.at(-1)
        if (latest === undefined) {
          providerError({
            code: 'session-not-found',
            message: `session '${request.sessionId}' has no prompt`,
            details: { sessionId: request.sessionId },
          })
        }
        this.appendPromptTurn(request.sessionId, prompts.length - 1, {
          kind: 'aborted',
          reason: { kind: 'user' },
        })
        this.setIdle(request.sessionId)
        return { accepted: true as const }
      },
    }
  }

  install(): void {
    this.ctx.provide('sessionController', this.sessionController)
    this.ctx.provide('sessions', {
      get: (id: SessionIdType) => this.agents.get(id)?.session,
      list: () => [...this.agents.values()].map(agent => agent.session),
    } as never)
    this.ctx.provide('agents', {
      get: (id: SessionIdType) => this.agents.get(id),
      list: () => [...this.agents.values()],
    } as never)
    this.ctx.provide('sessionPersistence', {
      open: async (id: SessionIdType) => {
        if (this.nextInspectError !== undefined) {
          const error = this.nextInspectError
          this.nextInspectError = undefined
          throw error
        }
        const session = this.sessions.get(id)
        if (session === undefined) throw new Error(`session '${id}' not found`)
        return {
          id,
          header: session.header,
          access: 'read',
          read: async () => ({ eventState: 'detached', events: session.snapshotEvents() }),
          close: async () => {},
        }
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
