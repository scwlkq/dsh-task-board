/** ApiProxy provider for task-board Session admission. @module @deepseek-ai/dsh-task-board-session-apiproxy */

import { RpcId, type PromptContentPart } from '@deepseek-ai/dsh-host-apiproxy'
import { TaskBoardSessionGateway } from './session.ts'
import type {
  TaskBoardSessionCancelRequest,
  TaskBoardSessionCreateRequest,
  TaskBoardSessionFailure,
  TaskBoardSessionPromptRequest,
  TaskBoardSessionResult,
} from './session-types.ts'

function failure(error: { readonly code: string; readonly message: string }): TaskBoardSessionFailure {
  return { code: error.code, message: error.message }
}

/** Task-board Session provider backed by the Host's ordinary ApiProxy methods. */
export class ApiProxyTaskBoardSessionGateway extends TaskBoardSessionGateway {
  static inject = ['apiProxy']

  /** @inheritdoc */
  async create(
    request: TaskBoardSessionCreateRequest,
  ): Promise<TaskBoardSessionResult<{ readonly sessionId: TaskBoardSessionCreateRequest['sessionId'] }>> {
    const response = await this.ctx.apiProxy.sessions.create({
      rpcId: RpcId(request.requestId),
      payload: {
        sessionId: request.sessionId,
        ...(request.workspaceId === undefined ? {} : { workspaceId: request.workspaceId }),
        ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
        ...(request.agentPreset === undefined ? {} : { agentPreset: request.agentPreset }),
      },
    })
    if (!response.result.ok) return { ok: false, error: failure(response.result.error) }
    return { ok: true, value: { sessionId: response.result.value.sessionId } }
  }

  /** @inheritdoc */
  async prompt(
    request: TaskBoardSessionPromptRequest,
  ): Promise<TaskBoardSessionResult<{ readonly accepted: true }>> {
    const content: PromptContentPart[] = request.content.map(part => ({ ...part }))
    const response = await this.ctx.apiProxy.sessions.prompt({
      rpcId: RpcId(request.requestId),
      payload: { sessionId: request.sessionId, mode: 'queue', content },
    })
    if (!response.result.ok) return { ok: false, error: failure(response.result.error) }
    return { ok: true, value: { accepted: true } }
  }

  /** @inheritdoc */
  async cancel(
    request: TaskBoardSessionCancelRequest,
  ): Promise<TaskBoardSessionResult<{ readonly accepted: true }>> {
    const response = await this.ctx.apiProxy.sessions.cancel({
      rpcId: RpcId(request.requestId),
      payload: { sessionId: request.sessionId },
    })
    if (!response.result.ok) return { ok: false, error: failure(response.result.error) }
    return { ok: true, value: { accepted: true } }
  }
}

export default ApiProxyTaskBoardSessionGateway
