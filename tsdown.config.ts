import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, resolve as resolvePath, sep } from 'node:path'
import { defineConfig, type UserConfig } from 'tsdown'
import { transform } from 'lightningcss'

const PACKAGE_NAME = 'dsh-task-board'
const REMOTE_EXPORT = `${PACKAGE_NAME}/remote`
const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  '@deepseek-ai/dsh-client-runtime/client',
  '@deepseek-ai/dsh-client-ui-primitives',
]
const CLIENT_BUNDLED_DEPENDENCIES = [
  '@dnd-kit/accessibility',
  '@dnd-kit/core',
  '@dnd-kit/sortable',
  '@dnd-kit/utilities',
  '@tanstack/react-virtual',
  '@tanstack/virtual-core',
  'clsx',
  'zod',
]

function sourceAssetPath(source: string, importer: string): string {
  const emitted = resolvePath(dirname(importer), source)
  if (existsSync(emitted)) return emitted
  const marker = `${sep}lib${sep}types${sep}`
  const boundary = emitted.indexOf(marker)
  if (boundary < 0) return emitted
  return resolvePath(emitted.slice(0, boundary), 'src', emitted.slice(boundary + marker.length))
}

/**
 * Serializes CSS module exports with a stable property order.
 *
 * @param cssExports CSS class names emitted by Lightning CSS.
 * @returns A deterministic JSON object mapping local names to generated names.
 */
export function serializeCssClassMap(
  cssExports: Readonly<Record<string, { readonly name: string }>> | undefined,
): string {
  const entries = Object.entries(cssExports ?? {}).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  )
  return JSON.stringify(
    Object.fromEntries(entries.map(([local, exported]) => [local, exported.name])),
  )
}

const host: UserConfig = {
  name: PACKAGE_NAME,
  entry: { index: 'lib/types/index.js' },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  sourcemap: false,
}

const client: UserConfig = {
  name: `${PACKAGE_NAME}/client`,
  entry: { client: 'lib/types/client/index.js' },
  outDir: 'lib',
  format: ['cjs'],
  platform: 'browser',
  target: 'es2022',
  minify: true,
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: CLIENT_EXTERNALS,
    alwaysBundle: (id: string) => CLIENT_EXTERNALS.includes(id) ? undefined : true,
    onlyBundle: CLIENT_BUNDLED_DEPENDENCIES,
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  plugins: [
    {
      name: 'dsh-task-board-remote',
      resolveId(source: string) {
        if (source !== REMOTE_EXPORT) return null
        return resolvePath('lib/typert.remote-client.js')
      },
    },
    {
      name: 'dsh-css-modules-inline',
      resolveId(source: string, importer: string | undefined) {
        if (!source.endsWith('.module.css')) return null
        const absolute = importer === undefined ? source : sourceAssetPath(source, importer)
        return CSS_VIRTUAL_PREFIX + absolute + CSS_VIRTUAL_SUFFIX
      },
      async load(virtualId: string) {
        if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
        const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
        this.addWatchFile(fileId)
        const source = await readFile(fileId)
        const { code, exports: cssExports } = transform({
          filename: fileId,
          code: source,
          cssModules: { pattern: '[hash]_[local]' },
          minify: true,
        })
        const tagId = `${PACKAGE_NAME}/${basename(fileId)}`
        return [
          `const css = ${JSON.stringify(code.toString())};`,
          `const tagId = ${JSON.stringify(tagId)};`,
          'if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {',
          '  const tag = document.createElement("style");',
          `  tag.dataset.plugin = ${JSON.stringify(PACKAGE_NAME)};`,
          '  tag.dataset.pluginCss = tagId;',
          '  tag.textContent = css;',
          '  document.head.appendChild(tag);',
          '}',
          `export default ${serializeCssClassMap(cssExports)};`,
        ].join('\n')
      },
    },
  ],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE_NAME)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default defineConfig([host, client])
