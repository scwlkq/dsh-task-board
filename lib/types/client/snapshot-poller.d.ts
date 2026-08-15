/** Non-overlapping scheduler for authoritative Task Board snapshots. */
/** Snapshot polling lifecycle options. */
export interface SnapshotPollerOptions {
    /** Delay after one refresh settles before the next refresh begins. */
    readonly intervalMs: number;
    /** Receives unexpected refresh failures without stopping future polling. */
    readonly onError?: (error: unknown) => void;
}
/** Schedules at most one snapshot request at a time. */
export declare class SnapshotPoller {
    private readonly refresh;
    private readonly intervalMs;
    private readonly onError;
    private active;
    private requested;
    private timer;
    private inFlight;
    /**
     * Create one polling lifecycle.
     * @param refresh - reads and applies one authoritative snapshot.
     * @param options - polling delay and error reporter.
     */
    constructor(refresh: () => Promise<void>, options: SnapshotPollerOptions);
    /**
     * Start polling and wait for the initial snapshot.
     * @returns completion of the initial refresh and any coalesced immediate refresh.
     */
    start(): Promise<void>;
    /**
     * Request an immediate refresh without overlapping an active request.
     * @returns completion after the requested refresh settles.
     */
    refreshNow(): Promise<void>;
    /** Stop polling and suppress scheduling after an active request settles. */
    dispose(): void;
    private drain;
    private schedule;
    private clearTimer;
}
