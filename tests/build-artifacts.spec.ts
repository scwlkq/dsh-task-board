import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')

describe('prebuilt community package artifacts', () => {
  it.each([
    'lib/index.js',
    'lib/client.js',
    'lib/client.js.map',
    'lib/types/index.d.ts',
    'lib/types/types.d.ts',
    'lib/types/client/index.d.ts',
    'lib/typert.host.js',
    'lib/typert.remote-client.js',
  ])('contains %s', relativePath => {
    expect(existsSync(resolve(root, relativePath))).toBe(true)
  })

  it('registers one browser module under the install package name', () => {
    const clientPath = resolve(root, 'lib/client.js')
    expect(existsSync(clientPath)).toBe(true)
    if (!existsSync(clientPath)) return

    const source = readFileSync(clientPath, 'utf8')
    const registrations = source.match(
      /window\.__ModuleLoader__\.load\(\{\s*id:\s*["'`]dsh-task-board["'`]/g,
    )
    expect(registrations).toHaveLength(1)
    expect(source).not.toContain('@deepseek-ai/dsh-api-remotes')
    expect(source).not.toContain('task-board/changed')
  })
})
