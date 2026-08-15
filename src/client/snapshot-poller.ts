/** Non-overlapping scheduler for authoritative Task Board snapshots. */

/** Snapshot polling lifecycle options. */
export interface SnapshotPollerOptions {
  /** Delay after one refresh settles before the next refresh begins. */
  readonly intervalMs: number
  /** Receives unexpected refresh failures without stopping future polling. */
  readonly onError?: (error: unknown) => void
}

function reportPollingError(error: unknown): void {
  console.error('task-board: snapshot refresh failed', error)
}

/** Schedules at most one snapshot request at a time. */
export class SnapshotPoller {
  private readonly intervalMs: number
  private readonly onError: (error: unknown) => void
  private active = false
  private requested = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private inFlight: Promise<void> | null = null

  /**
   * Create one polling lifecycle.
   * @param refresh - reads and applies one authoritative snapshot.
   * @param options - polling delay and error reporter.
   */
  constructor(
    private readonly refresh: () => Promise<void>,
    options: SnapshotPollerOptions,
  ) {
    if (!Number.isSafeInteger(options.intervalMs) || options.intervalMs < 1) {
      throw new TypeError(`task-board: polling interval must be a positive safe integer, got ${String(options.intervalMs)}`)
    }
    this.intervalMs = options.intervalMs
    this.onError = options.onError ?? reportPollingError
  }

  /**
   * Start polling and wait for the initial snapshot.
   * @returns completion of the initial refresh and any coalesced immediate refresh.
   */
  start(): Promise<void> {
    if (!this.active) this.active = true
    return this.refreshNow()
  }

  /**
   * Request an immediate refresh without overlapping an active request.
   * @returns completion after the requested refresh settles.
   */
  refreshNow(): Promise<void> {
    if (!this.active) return Promise.resolve()
    this.requested = true
    this.clearTimer()
    if (this.inFlight !== null) return this.inFlight

    const pending = this.drain()
    this.inFlight = pending
    void pending.finally(() => {
      if (this.inFlight === pending) this.inFlight = null
    })
    return pending
  }

  /** Stop polling and suppress scheduling after an active request settles. */
  dispose(): void {
    this.active = false
    this.requested = false
    this.clearTimer()
  }

  private async drain(): Promise<void> {
    while (this.active && this.requested) {
      this.requested = false
      try {
        await this.refresh()
      } catch (error) {
        this.onError(error)
      }
    }
    if (this.active) this.schedule()
  }

  private schedule(): void {
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.refreshNow()
    }, this.intervalMs)
  }

  private clearTimer(): void {
    if (this.timer === undefined) return
    clearTimeout(this.timer)
    this.timer = undefined
  }
}
