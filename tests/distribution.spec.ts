import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { load } from "js-yaml"
import { describe, expect, it } from "vitest"

const root = resolve(import.meta.dirname, "..")
const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
  readonly name?: string
  readonly scripts?: Readonly<Record<string, string>>
  readonly exports?: Readonly<Record<string, unknown>>
  readonly files?: readonly string[]
  readonly dsh?: {
    readonly bundle?: { readonly patch?: string }
    readonly client?: unknown
  }
}

describe("community package distribution", () => {
  it("uses one installable package for bundle and client metadata", () => {
    expect(manifest.name).toBe("dsh-task-board")
    expect(manifest.dsh?.bundle?.patch).toBe("./cordis.patch.yml")
    expect(manifest.dsh?.client).toBeTypeOf("object")
  })

  it("publishes every runtime face as a prebuilt artifact", () => {
    expect(Object.keys(manifest.exports ?? {})).toEqual(
      expect.arrayContaining([".", "./types", "./typert", "./remote", "./client"]),
    )
    expect(manifest.files).toEqual(
      expect.arrayContaining([
        "cordis.patch.yml",
        "lib/index.js",
        "lib/client.js",
        "lib/typert.host.js",
        "lib/typert.remote-client.js",
      ]),
    )
  })

  it("does not execute lifecycle build scripts during GitHub installation", () => {
    for (const name of ["prepare", "preinstall", "install", "postinstall"]) {
      expect(manifest.scripts?.[name]).toBeUndefined()
    }
  })

  it("adds exactly one Loader entry", () => {
    const patchPath = resolve(root, "cordis.patch.yml")
    expect(existsSync(patchPath)).toBe(true)
    if (!existsSync(patchPath)) return

    expect(load(readFileSync(patchPath, "utf8"))).toEqual([
      {
        insert: [
          {
            id: "task-board",
            name: "dsh-task-board",
          },
        ],
      },
    ])
  })
})

