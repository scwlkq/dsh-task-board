/**
 * Browser object layer for the authoritative task-board snapshot.
 * @module @deepseek-ai/dsh-client-ui-task-board/client/controller
 */
/**
 * Resolve a correction-oriented message from an open carrier/business failure.
 * @param error - normalized task-board failure.
 * @returns Host message when present, otherwise stable failure code.
 */
export function taskBoardErrorMessage(error) {
    return 'message' in error ? error.message : error.code;
}
const STATUS_ORDER = {
    initialized: 0,
    running: 1,
    review: 2,
    done: 3,
    failed: 4,
};
const INITIAL_VIEW = Object.freeze({
    status: 'cold',
    boardRevision: 0,
    tasks: Object.freeze([]),
    pendingTaskIds: Object.freeze([]),
    creating: false,
    error: null,
});
function ordered(tasks) {
    return [...tasks].sort((left, right) => {
        const status = STATUS_ORDER[left.status] - STATUS_ORDER[right.status];
        if (status !== 0)
            return status;
        const position = left.position.localeCompare(right.position);
        if (position !== 0)
            return position;
        return left.sequence - right.sequence;
    });
}
function transportError(error) {
    return {
        code: 'client-operation-failed',
        message: error instanceof Error ? error.message : String(error),
        details: {},
    };
}
function notFound(taskId) {
    return { ok: false, error: { code: 'task-not-found', taskId } };
}
/**
 * Owns task-board Remote synchronization and mutation serialization state.
 * Components consume it through the slot framework's injected observable hook.
 */
export class TaskBoardController {
    remote;
    view = INITIAL_VIEW;
    listeners = new Set();
    pendingTaskCounts = new Map();
    refreshPromise = null;
    disposed = false;
    /**
     * @param remote - generated `taskBoard` Remote namespace.
     */
    constructor(remote) {
        this.remote = remote;
    }
    /** @returns current immutable board projection. */
    getSnapshot = () => this.view;
    /**
     * Subscribe to projection replacement.
     * @param listener - callback invoked after each committed Client view change.
     * @returns subscription disposer.
     */
    subscribe = (listener) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };
    /**
     * Read a full authoritative snapshot, coalescing concurrent callers.
     * @returns normalized load result.
     */
    refresh() {
        if (this.disposed) {
            return Promise.resolve({ ok: false, error: transportError(new Error('task-board controller disposed')) });
        }
        if (this.refreshPromise !== null)
            return this.refreshPromise;
        this.patch({ status: 'loading', error: null });
        const pending = this.readSnapshot();
        this.refreshPromise = pending;
        void pending.finally(() => {
            this.refreshPromise = null;
        });
        return pending;
    }
    /**
     * Reconcile one forwarded committed Host change.
     * @param change - revisioned task-board event.
     * @returns completion after any required snapshot refresh.
     */
    async acceptChange(change) {
        if (this.disposed)
            return;
        if (this.refreshPromise !== null)
            await this.refreshPromise;
        if (change.boardRevision <= this.view.boardRevision)
            return;
        if (this.view.status === 'cold' || change.boardRevision !== this.view.boardRevision + 1) {
            await this.refresh();
            return;
        }
        if (change.operation === 'deleted') {
            this.commit({
                ...this.view,
                boardRevision: change.boardRevision,
                tasks: this.view.tasks.filter(task => task.id !== change.taskId),
            });
            return;
        }
        if (change.task === undefined) {
            await this.refresh();
            return;
        }
        this.commit({
            ...this.view,
            boardRevision: change.boardRevision,
            tasks: this.upsert(this.view.tasks, change.task),
        });
    }
    /**
     * Re-read authority after a new transport generation is established.
     * @returns normalized refresh result.
     */
    connectionReset() {
        return this.refresh();
    }
    /**
     * Create a durable card and optionally start its first execution round.
     * @param request - card fields and start intent.
     * @returns committed card or normalized failure.
     */
    async create(request) {
        this.patch({ creating: true });
        try {
            const carried = await this.remote.create(request);
            if (!carried.ok)
                return { ok: false, error: carried.error };
            if (!carried.value.ok)
                return carried.value;
            this.replaceTask(carried.value.value);
            return carried.value;
        }
        catch (error) {
            return { ok: false, error: transportError(error) };
        }
        finally {
            this.patch({ creating: false });
        }
    }
    /**
     * Persist one browser-staged task image without changing the board projection.
     * @param request - Canonical image upload payload.
     * @returns Durable attachment reference or normalized failure.
     */
    async uploadAttachment(request) {
        try {
            const carried = await this.remote.uploadAttachment(request);
            return carried.ok ? carried.value : { ok: false, error: carried.error };
        }
        catch (error) {
            return { ok: false, error: transportError(error) };
        }
    }
    /**
     * Edit material task fields using the latest observed revision.
     * @param taskId - card identity.
     * @param patch - replacement fields.
     * @returns committed card or normalized failure.
     */
    edit(taskId, patch) {
        return this.mutateTask(taskId, ref => this.remote.edit(ref, patch));
    }
    /**
     * Start one initialized card.
     * @param taskId - card identity.
     * @returns committed running card or normalized failure.
     */
    start(taskId) {
        return this.mutateTask(taskId, ref => this.remote.start(ref));
    }
    /**
     * Add another instruction to the active execution round.
     * @param taskId - card identity.
     * @param text - non-blank follow-up text.
     * @returns committed card or normalized failure.
     */
    followup(taskId, text) {
        return this.mutateTask(taskId, ref => this.remote.followup(ref, { text }));
    }
    /**
     * Approve reviewed output.
     * @param taskId - card identity.
     * @returns committed completed card or normalized failure.
     */
    approve(taskId) {
        return this.mutateTask(taskId, ref => this.remote.approve(ref));
    }
    /**
     * Reject reviewed output and start a feedback revision round.
     * @param taskId - card identity.
     * @param feedback - required review feedback.
     * @returns committed running card or normalized failure.
     */
    reject(taskId, feedback) {
        return this.mutateTask(taskId, ref => this.remote.reject(ref, { feedback }));
    }
    /**
     * Retry a failed card under the Host continuity policy.
     * @param taskId - card identity.
     * @param allowFreshSession - explicit permission to replace an unavailable Session.
     * @returns committed running card or normalized failure.
     */
    retry(taskId, allowFreshSession) {
        return this.mutateTask(taskId, ref => this.remote.retry(ref, { allowFreshSession }));
    }
    /**
     * Stop the active task round.
     * @param taskId - card identity.
     * @returns reconciled card or normalized failure.
     */
    stop(taskId) {
        return this.mutateTask(taskId, ref => this.remote.stop(ref));
    }
    /**
     * Reopen an approved card as initialized work.
     * @param taskId - card identity.
     * @returns committed initialized card or normalized failure.
     */
    reopen(taskId) {
        return this.mutateTask(taskId, ref => this.remote.reopen(ref));
    }
    /**
     * Delete one non-running card.
     * @param taskId - card identity.
     * @returns deletion receipt or normalized failure.
     */
    async delete(taskId) {
        const current = this.view.tasks.find(task => task.id === taskId);
        if (current === undefined)
            return notFound(taskId);
        this.setPending(taskId, true);
        try {
            const carried = await this.remote.delete({ id: taskId, revision: current.revision });
            if (!carried.ok)
                return { ok: false, error: carried.error };
            const result = carried.value;
            if (!result.ok) {
                this.reconcileConflict(result.error);
                return result;
            }
            this.patch({ tasks: this.view.tasks.filter(task => task.id !== taskId) });
            return result;
        }
        catch (error) {
            return { ok: false, error: transportError(error) };
        }
        finally {
            this.setPending(taskId, false);
        }
    }
    /**
     * Optimistically move a card before another card in the same state.
     * @param taskId - moved card identity.
     * @param beforeTaskId - same-state anchor, or undefined to append.
     * @returns committed card or normalized failure.
     */
    async reorder(taskId, beforeTaskId) {
        const current = this.view.tasks.find(task => task.id === taskId);
        if (current === undefined)
            return notFound(taskId);
        const before = beforeTaskId === undefined
            ? undefined
            : this.view.tasks.find(task => task.id === beforeTaskId);
        if (before !== undefined && before.status !== current.status) {
            return {
                ok: false,
                error: { code: 'invalid-transition', status: current.status, operation: 'reorder' },
            };
        }
        const baselineRevision = this.view.boardRevision;
        const baselineTasks = this.view.tasks;
        const optimistic = this.optimisticOrder(current, beforeTaskId);
        this.patch({ tasks: optimistic });
        const result = await this.mutateTask(taskId, ref => this.remote.reorder(ref, beforeTaskId === undefined ? {} : { beforeTaskId }));
        if (!result.ok) {
            if (this.view.boardRevision === baselineRevision)
                this.patch({ tasks: baselineTasks });
            else
                await this.refresh();
        }
        return result;
    }
    /** Release subscribers and prevent later Remote completions from publishing. */
    dispose() {
        this.disposed = true;
        this.listeners.clear();
    }
    async readSnapshot() {
        try {
            const carried = await this.remote.snapshot();
            if (!carried.ok) {
                this.patch({ status: 'error', error: carried.error });
                return { ok: false, error: carried.error };
            }
            const result = carried.value;
            if (!result.ok) {
                this.patch({ status: 'error', error: result.error });
                return result;
            }
            this.commit({
                ...this.view,
                status: 'ready',
                boardRevision: result.value.boardRevision,
                tasks: ordered(result.value.tasks),
                error: null,
            });
            return { ok: true, value: result.value.tasks };
        }
        catch (error) {
            const failure = transportError(error);
            this.patch({ status: 'error', error: failure });
            return { ok: false, error: failure };
        }
    }
    async mutateTask(taskId, invoke) {
        const current = this.view.tasks.find(task => task.id === taskId);
        if (current === undefined)
            return notFound(taskId);
        this.setPending(taskId, true);
        try {
            const carried = await invoke({ id: taskId, revision: current.revision });
            if (!carried.ok)
                return { ok: false, error: carried.error };
            const result = carried.value;
            if (!result.ok) {
                this.reconcileConflict(result.error);
                return result;
            }
            this.replaceTask(result.value);
            return result;
        }
        catch (error) {
            return { ok: false, error: transportError(error) };
        }
        finally {
            this.setPending(taskId, false);
        }
    }
    reconcileConflict(error) {
        if (error.code === 'revision-conflict')
            this.replaceTask(error.current);
    }
    optimisticOrder(task, beforeTaskId) {
        const peers = this.view.tasks.filter(item => item.status === task.status && item.id !== task.id);
        const anchor = beforeTaskId === undefined
            ? peers.length
            : peers.findIndex(item => item.id === beforeTaskId);
        peers.splice(anchor < 0 ? peers.length : anchor, 0, task);
        let peerIndex = 0;
        return this.view.tasks.map((item) => {
            if (item.status !== task.status)
                return item;
            return peers[peerIndex++];
        });
    }
    replaceTask(task) {
        const observed = this.view.tasks.find(item => item.id === task.id);
        if (observed !== undefined && observed.revision > task.revision)
            return;
        this.patch({ tasks: this.upsert(this.view.tasks, task) });
    }
    upsert(tasks, task) {
        const index = tasks.findIndex(item => item.id === task.id);
        if (index < 0)
            return ordered([...tasks, task]);
        const next = [...tasks];
        next[index] = task;
        return ordered(next);
    }
    setPending(taskId, pending) {
        const current = this.view.pendingTaskIds;
        if (pending) {
            const count = this.pendingTaskCounts.get(taskId) ?? 0;
            this.pendingTaskCounts.set(taskId, count + 1);
            if (count === 0)
                this.patch({ pendingTaskIds: [...current, taskId] });
            return;
        }
        const count = this.pendingTaskCounts.get(taskId);
        if (count > 1) {
            this.pendingTaskCounts.set(taskId, count - 1);
            return;
        }
        this.pendingTaskCounts.delete(taskId);
        this.patch({ pendingTaskIds: current.filter(id => id !== taskId) });
    }
    patch(patch) {
        this.commit({ ...this.view, ...patch });
    }
    commit(next) {
        if (this.disposed)
            return;
        this.view = next;
        for (const listener of this.listeners)
            listener();
    }
}
