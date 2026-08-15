import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')

await Promise.all([
  rm(resolve(root, 'lib/types'), { recursive: true, force: true }),
  rm(resolve(root, 'lib/index.js'), { force: true }),
  rm(resolve(root, 'lib/index.js.map'), { force: true }),
  rm(resolve(root, 'lib/client.js'), { force: true }),
  rm(resolve(root, 'lib/client.js.map'), { force: true }),
])
