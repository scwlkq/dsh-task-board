import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')

interface PackFile {
  readonly path: string
}

interface PackResult {
  readonly files: readonly PackFile[]
}

function packedPaths(): readonly string[] {
  const output = execFileSync('pnpm', ['pack', '--dry-run', '--json'], {
    cwd: root,
    encoding: 'utf8',
  })
  const result = JSON.parse(output) as PackResult
  return result.files.map((file) => file.path)
}

describe('community package tarball', () => {
  it('contains documentation and every runtime entry', () => {
    expect(packedPaths()).toEqual(expect.arrayContaining([
      'README.md',
      'README.zh.md',
      'LICENSE',
      'package.json',
      'cordis.patch.yml',
      'lib/index.js',
      'lib/client.js',
      'lib/client.js.map',
      'lib/typert.host.js',
      'lib/typert.remote-client.js',
      'lib/types/index.d.ts',
      'lib/types/client/index.d.ts',
    ]))
  })

  it('excludes development sources and tests', () => {
    const paths = packedPaths()
    expect(paths.some((path) => path.startsWith('src/'))).toBe(false)
    expect(paths.some((path) => path.startsWith('tests/'))).toBe(false)
    expect(paths.some((path) => path.startsWith('scripts/'))).toBe(false)
    expect(paths.some((path) => path.startsWith('tsconfig'))).toBe(false)
  })
})
