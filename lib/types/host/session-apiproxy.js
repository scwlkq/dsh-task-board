/** ApiProxy provider for task-board Session admission. @module @deepseek-ai/dsh-task-board-session-apiproxy */
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy';
import { TaskBoardSessionGateway } from "./session.js";
function failure(error) {
    return { code: error.code, message: error.message };
}
/** Task-board Session provider backed by the Host's ordinary ApiProxy methods. */
export class ApiProxyTaskBoardSessionGateway extends TaskBoardSessionGateway {
    static inject = ['apiProxy'];
    /** @inheritdoc */
    async create(request) {
        const response = await this.ctx.apiProxy.sessions.create({
            rpcId: RpcId(request.requestId),
            payload: {
                sessionId: request.sessionId,
                ...(request.workspaceId === undefined ? {} : { workspaceId: request.workspaceId }),
                ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
                ...(request.agentPreset === undefined ? {} : { agentPreset: request.agentPreset }),
            },
        });
        if (!response.result.ok)
            return { ok: false, error: failure(response.result.error) };
        return { ok: true, value: { sessionId: response.result.value.sessionId } };
    }
    /** @inheritdoc */
    async prompt(request) {
        const content = request.content.map(part => ({ ...part }));
        const response = await this.ctx.apiProxy.sessions.prompt({
            rpcId: RpcId(request.requestId),
            payload: { sessionId: request.sessionId, mode: 'queue', content },
        });
        if (!response.result.ok)
            return { ok: false, error: failure(response.result.error) };
        return { ok: true, value: { accepted: true } };
    }
    /** @inheritdoc */
    async cancel(request) {
        const response = await this.ctx.apiProxy.sessions.cancel({
            rpcId: RpcId(request.requestId),
            payload: { sessionId: request.sessionId },
        });
        if (!response.result.ok)
            return { ok: false, error: failure(response.result.error) };
        return { ok: true, value: { accepted: true } };
    }
}
export default ApiProxyTaskBoardSessionGateway;
