import { describe, expect, it } from 'vitest'

import { serializeCssClassMap } from '../tsdown.config.ts'

describe('client build configuration', () => {
  it('serializes CSS module exports in local-name order', () => {
    const expected = '{"badge":"hash_badge","label":"hash_label","root":"hash_root"}'
    const ascending = {
      badge: { name: 'hash_badge' },
      label: { name: 'hash_label' },
      root: { name: 'hash_root' },
    }
    const descending = {
      root: { name: 'hash_root' },
      label: { name: 'hash_label' },
      badge: { name: 'hash_badge' },
    }

    expect(serializeCssClassMap(ascending)).toBe(expected)
    expect(serializeCssClassMap(descending)).toBe(expected)
  })
})
