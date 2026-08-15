/** Task-board styles only consume design-platform theme aliases. */

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const stylesDirectory = fileURLToPath(new URL('../src/client/', import.meta.url))
const themeCss = readFileSync(
  fileURLToPath(new URL('./support/design-platform.css', import.meta.url)),
  'utf8',
)

describe('task-board theme aliases', () => {
  it('uses only aliases defined by the design platform', () => {
    const aliases = new Set<string>()
    for (const filename of readdirSync(stylesDirectory).filter(name => name.endsWith('.module.css'))) {
      const css = readFileSync(`${stylesDirectory}/${filename}`, 'utf8')
      for (const match of css.matchAll(/var\((--dsw-[a-z0-9-]+)/gi)) {
        const alias = match[1]
        if (alias !== undefined) aliases.add(alias)
      }
    }

    const undefinedAliases = [...aliases]
      .filter(alias => !themeCss.includes(`${alias}:`))
      .sort()

    expect(undefinedAliases).toEqual([])
  })

  it('does not hardcode a light-only foreground', () => {
    const filesWithWhiteForeground = readdirSync(stylesDirectory)
      .filter(name => name.endsWith('.module.css'))
      .filter(filename => readFileSync(`${stylesDirectory}/${filename}`, 'utf8').includes('color: #fff'))

    expect(filesWithWhiteForeground).toEqual([])
  })
})
