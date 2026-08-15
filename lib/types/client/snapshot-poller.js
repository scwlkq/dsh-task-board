/** Non-overlapping scheduler for authoritative Task Board snapshots. */
function reportPollingError(error) {
    console.error('task-board: snapshot refresh failed', error);
}
/** Schedules at most one snapshot request at a time. */
export class SnapshotPoller {
    refresh;
    intervalMs;
    onError;
    active = false;
    requested = false;
    timer;
    inFlight = null;
    /**
     * Create one polling lifecycle.
     * @param refresh - reads and applies one authoritative snapshot.
     * @param options - polling delay and error reporter.
     */
    constructor(refresh, options) {
        this.refresh = refresh;
        if (!Number.isSafeInteger(options.intervalMs) || options.intervalMs < 1) {
            throw new TypeError(`task-board: polling interval must be a positive safe integer, got ${String(options.intervalMs)}`);
        }
        this.intervalMs = options.intervalMs;
        this.onError = options.onError ?? reportPollingError;
    }
    /**
     * Start polling and wait for the initial snapshot.
     * @returns completion of the initial refresh and any coalesced immediate refresh.
     */
    start() {
        if (!this.active)
            this.active = true;
        return this.refreshNow();
    }
    /**
     * Request an immediate refresh without overlapping an active request.
     * @returns completion after the requested refresh settles.
     */
    refreshNow() {
        if (!this.active)
            return Promise.resolve();
        this.requested = true;
        this.clearTimer();
        if (this.inFlight !== null)
            return this.inFlight;
        const pending = this.drain();
        this.inFlight = pending;
        void pending.finally(() => {
            if (this.inFlight === pending)
                this.inFlight = null;
        });
        return pending;
    }
    /** Stop polling and suppress scheduling after an active request settles. */
    dispose() {
        this.active = false;
        this.requested = false;
        this.clearTimer();
    }
    async drain() {
        while (this.active && this.requested) {
            this.requested = false;
            try {
                await this.refresh();
            }
            catch (error) {
                this.onError(error);
            }
        }
        if (this.active)
            this.schedule();
    }
    schedule() {
        this.timer = setTimeout(() => {
            this.timer = undefined;
            void this.refreshNow();
        }, this.intervalMs);
    }
    clearTimer() {
        if (this.timer === undefined)
            return;
        clearTimeout(this.timer);
        this.timer = undefined;
    }
}
