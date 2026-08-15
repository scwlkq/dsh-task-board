import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SnapshotPoller } from '../src/client/snapshot-poller.ts'

describe('SnapshotPoller', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('refreshes immediately and schedules from settlement time', async () => {
    const refresh = vi.fn(async () => {})
    const poller = new SnapshotPoller(refresh, { intervalMs: 1_000 })

    await poller.start()
    expect(refresh).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(999)
    expect(refresh).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(refresh).toHaveBeenCalledTimes(2)

    poller.dispose()
  })

  it('never overlaps requests and honors one refresh requested in flight', async () => {
    let settle: (() => void) | undefined
    const refresh = vi.fn(() => new Promise<void>(resolve => {
      settle = resolve
    }))
    const poller = new SnapshotPoller(refresh, { intervalMs: 1_000 })

    const started = poller.start()
    expect(refresh).toHaveBeenCalledTimes(1)
    const reset = poller.refreshNow()
    expect(refresh).toHaveBeenCalledTimes(1)

    settle?.()
    await Promise.resolve()
    expect(refresh).toHaveBeenCalledTimes(2)
    settle?.()
    await Promise.all([started, reset])

    poller.dispose()
  })

  it('reports one failure and continues polling', async () => {
    const failure = new Error('connection unavailable')
    const refresh = vi.fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValue(undefined)
    const onError = vi.fn()
    const poller = new SnapshotPoller(refresh, { intervalMs: 250, onError })

    await poller.start()
    expect(onError).toHaveBeenCalledWith(failure)

    await vi.advanceTimersByTimeAsync(250)
    expect(refresh).toHaveBeenCalledTimes(2)
    poller.dispose()
  })

  it('does not schedule again after disposal during a request', async () => {
    let settle: (() => void) | undefined
    const refresh = vi.fn(() => new Promise<void>(resolve => {
      settle = resolve
    }))
    const poller = new SnapshotPoller(refresh, { intervalMs: 100 })

    const started = poller.start()
    poller.dispose()
    settle?.()
    await started
    await vi.advanceTimersByTimeAsync(1_000)

    expect(refresh).toHaveBeenCalledTimes(1)
  })
})
