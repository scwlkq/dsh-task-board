import { describe, expect, it, vi } from "vitest"
import {
  createTaskBoardComposition,
  type TaskBoardCompositionContext,
} from "../src/index.ts"

const config = {
  automaticTitleMaxChars: 80,
  maxTitleBytes: 4096,
  maxDescriptionBytes: 65_536,
  maxAcceptanceCriteriaBytes: 65_536,
  maxFeedbackBytes: 32_768,
  maxFollowupBytes: 32_768,
}

describe("root Host composition", () => {
  it("starts the Session provider before Task Board and disposes in reverse", async () => {
    const events: string[] = []
    const sessionDispose = vi.fn(() => {
      events.push("dispose:session")
    })
    const taskBoardDispose = vi.fn(() => {
      events.push("dispose:task-board")
    })
    const fibers = [
      {
        await: async () => {
          events.push("ready:session")
        },
        dispose: sessionDispose,
      },
      {
        await: async () => {
          events.push("ready:task-board")
        },
        dispose: taskBoardDispose,
      },
    ]
    const context = {
      plugin: vi.fn((plugin: unknown, pluginConfig?: unknown) => {
        events.push(pluginConfig === undefined ? "mount:session" : "mount:task-board")
        return fibers.shift()
      }),
    } as unknown as TaskBoardCompositionContext

    const composition = createTaskBoardComposition(context, config)
    const session = await composition.next()
    const taskBoard = await composition.next()

    expect(events).toEqual([
      "mount:session",
      "ready:session",
      "mount:task-board",
      "ready:task-board",
    ])
    expect(session.value).toBe(sessionDispose)
    expect(taskBoard.value).toBe(taskBoardDispose)

    taskBoard.value?.()
    session.value?.()
    expect(events.slice(-2)).toEqual(["dispose:task-board", "dispose:session"])
  })
})
