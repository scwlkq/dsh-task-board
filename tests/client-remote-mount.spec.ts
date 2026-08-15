import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import taskBoardRemote from 'dsh-task-board/remote'
import { mountTaskBoardRemote } from '../src/client/remote.ts'

const root = resolve(import.meta.dirname, '..')

describe('package-owned Client Remote', () => {
  it('mounts and returns the generated contribution disposer', async () => {
    const dispose = vi.fn()
    const mount = vi.fn(async () => dispose)

    await expect(mountTaskBoardRemote({ $mount: mount })).resolves.toBe(dispose)
    expect(mount).toHaveBeenCalledOnce()
    expect(mount).toHaveBeenCalledWith(taskBoardRemote)
  })

  it('publishes Host and Client descriptors under the installed package name', async () => {
    const hostPath = resolve(root, 'lib/typert.host.js')
    const remotePath = resolve(root, 'lib/typert.remote-client.js')

    expect(existsSync(hostPath)).toBe(true)
    expect(existsSync(remotePath)).toBe(true)
    if (!existsSync(hostPath) || !existsSync(remotePath)) return

    const host = await import(`${hostPath}?test=${Date.now()}`)
    const remote = await import(`${remotePath}?test=${Date.now()}`)
    expect(host.TYPERT.package).toBe('dsh-task-board')
    expect(remote.default.package).toBe('dsh-task-board')
  })

  it('does not depend on the application Remote assembly or forwarded event', () => {
    const clientRoot = resolve(root, 'src/client')
    const sources = ['remote.ts', 'index.ts']
      .map(name => resolve(clientRoot, name))
      .filter(existsSync)
      .map(path => readFileSync(path, 'utf8'))
      .join('\n')

    expect(sources).not.toContain('@deepseek-ai/dsh-api-remotes')
    expect(sources).not.toContain("$on('task-board/changed'")
    expect(sources).not.toContain('$on("task-board/changed"')
  })
})
