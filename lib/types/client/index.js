/**
 * Task-board browser plugin: one Host-backed controller, one shared root store,
 * and two contributions forming the sidebar launcher and frame overlay.
 * @module @deepseek-ai/dsh-client-ui-task-board/client
 */
import { TaskBoardController } from "./controller.js";
import { TaskBoardLauncher } from "./TaskBoardLauncher.js";
import { TaskBoardOverlay } from "./TaskBoardOverlay.js";
import { createTaskBoardStore } from "./store.js";
import { en, NS, zh } from "./locales.js";
import { loadRoundHistory } from "./history.js";
import { mountTaskBoardRemote } from "./remote.js";
import { SnapshotPoller } from "./snapshot-poller.js";
const SNAPSHOT_POLL_INTERVAL_MS = 1_000;
export { TaskBoardController } from "./controller.js";
export { taskBoardErrorMessage } from "./controller.js";
export { TaskBoardLauncher } from "./TaskBoardLauncher.js";
export { TaskBoardOverlay } from "./TaskBoardOverlay.js";
export { createTaskBoardStore } from "./store.js";
export { loadRoundHistory } from "./history.js";
/** Services required by the browser plugin. */
export const inject = ['slots', 'locale', 'remote', 'sessions', 'workspaces', 'connection'];
/**
 * Register the task-board synchronization layer and both UI entries.
 * @param ctx - Client root context.
 */
export async function apply(ctx) {
    const unmountRemote = await mountTaskBoardRemote(ctx.remote);
    ctx.effect(() => unmountRemote, 'ui-task-board: remote contribution');
    const taskBoard = ctx.get('remote.taskBoard');
    if (taskBoard === undefined) {
        throw new Error('task-board Remote contribution mounted without remote.taskBoard');
    }
    const controller = new TaskBoardController(taskBoard);
    const poller = new SnapshotPoller(async () => {
        await controller.refresh();
    }, { intervalMs: SNAPSHOT_POLL_INTERVAL_MS });
    const store = createTaskBoardStore();
    const connection = ctx.get('connection');
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-task-board: dictionaries');
    ctx.effect(() => {
        const disposeReset = ctx.on('connection/reset', () => {
            void controller.connectionReset();
            void poller.refreshNow();
        });
        void poller.start();
        return () => {
            disposeReset();
            poller.dispose();
            controller.dispose();
        };
    }, 'ui-task-board: synchronization');
    const injected = () => ({
        hooks: { board: controller },
        refresh: () => controller.refresh(),
        loadAgentPresets: async () => {
            const response = await connection.api.agentPresets.list({});
            if (!response.result.ok)
                throw new Error(response.result.error.message);
            return response.result.value.presets.flatMap(preset => preset.broken === undefined
                ? [{
                        id: preset.id,
                        isDefault: preset.isDefault,
                        ...(preset.name === undefined ? {} : { name: preset.name }),
                        ...(preset.description === undefined ? {} : { description: preset.description }),
                    }]
                : []);
        },
        pickDirectory: () => ctx.workspaces.pickDirectory(),
        uploadAttachment: request => controller.uploadAttachment(request),
        create: request => controller.create(request),
        edit: (taskId, patch) => controller.edit(taskId, patch),
        reorder: (taskId, beforeTaskId) => controller.reorder(taskId, beforeTaskId),
        start: taskId => controller.start(taskId),
        followup: (taskId, text) => controller.followup(taskId, text),
        approve: taskId => controller.approve(taskId),
        reject: (taskId, feedback) => controller.reject(taskId, feedback),
        retry: (taskId, allowFreshSession) => controller.retry(taskId, allowFreshSession),
        stop: taskId => controller.stop(taskId),
        reopen: taskId => controller.reopen(taskId),
        delete: taskId => controller.delete(taskId),
        loadRoundHistory: (round, signal) => loadRoundHistory(connection.api, round, signal),
        openSession: (sessionId) => { ctx.sessions.open(sessionId); },
    });
    ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
        name: 'sidebar.footer.action',
        id: 'task-board',
        order: -20,
        locale: NS,
        store,
        inject: injected,
    }, TaskBoardLauncher));
    ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'task-board',
        order: 0,
        locale: NS,
        store,
        inject: injected,
    }, TaskBoardOverlay));
}
