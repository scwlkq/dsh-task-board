/** SessionController provider for task-board Session admission. @module @deepseek-ai/dsh-task-board-session-apiproxy */

import type { PromptContentPart, SessionCreateRequest, SessionCancelRequest, SessionPromptRequest } from '@deepseek-ai/dsh-api-session-controller/types'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import { TaskBoardSessionGateway } from './session.ts'
import type {
  TaskBoardSessionCancelRequest,
  TaskBoardSessionCreateRequest,
  TaskBoardSessionFailure,
  TaskBoardSessionPromptRequest,
  TaskBoardSessionResult,
} from './session-types.ts'

/**
 * Map one Session Controller failure to a client-safe task-board failure.
 * RemoteErrors carry the owner's stable business code and are converted in
 * place; unknown errors are left for the caller so the service can normalize
 * transport and assembly faults with its own codes.
 */
function failure(error: unknown): TaskBoardSessionFailure | undefined {
  const remote = remoteErrorOf(error)
  if (remote === undefined) return undefined
  return { code: remote.code, message: remote.message }
}

/** Task-board Session provider backed by the Host's ordinary SessionController. */
export class ApiProxyTaskBoardSessionGateway extends TaskBoardSessionGateway {
  static inject = ['sessionController']

  /** @inheritdoc */
  async create(
    request: TaskBoardSessionCreateRequest,
  ): Promise<TaskBoardSessionResult<{ readonly sessionId: TaskBoardSessionCreateRequest['sessionId'] }>> {
    try {
      const payload: SessionCreateRequest = {
        sessionId: request.sessionId,
        ...(request.workspaceId === undefined ? {} : { workspaceId: request.workspaceId }),
        ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
        ...(request.agentPreset === undefined ? {} : { agentPreset: request.agentPreset }),
      }
      const value = await this.ctx.sessionController.create(payload)
      return { ok: true, value: { sessionId: value.sessionId } }
    } catch (error) {
      const admitted = failure(error)
      if (admitted === undefined) throw error
      return { ok: false, error: admitted }
    }
  }

  /** @inheritdoc */
  async prompt(
    request: TaskBoardSessionPromptRequest,
  ): Promise<TaskBoardSessionResult<{ readonly accepted: true }>> {
    try {
      const content: PromptContentPart[] = request.content.map(part => ({ ...part }) as PromptContentPart)
      const payload: SessionPromptRequest = {
        requestId: request.requestId as unknown as SessionPromptRequest['requestId'],
        sessionId: request.sessionId,
        mode: 'queue',
        content,
      }
      await this.ctx.sessionController.prompt(payload, new AbortController().signal)
      return { ok: true, value: { accepted: true } }
    } catch (error) {
      const admitted = failure(error)
      if (admitted === undefined) throw error
      return { ok: false, error: admitted }
    }
  }

  /** @inheritdoc */
  async cancel(
    request: TaskBoardSessionCancelRequest,
  ): Promise<TaskBoardSessionResult<{ readonly accepted: true }>> {
    try {
      const payload: SessionCancelRequest = { sessionId: request.sessionId }
      this.ctx.sessionController.cancel(payload)
      return { ok: true, value: { accepted: true } }
    } catch (error) {
      const admitted = failure(error)
      if (admitted === undefined) throw error
      return { ok: false, error: admitted }
    }
  }
}

export default ApiProxyTaskBoardSessionGateway
