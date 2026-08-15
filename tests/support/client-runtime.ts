import { Service, type Context } from '@deepseek-ai/cordis'

export interface ObservableSnapshot<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

export interface SnapshotStore<T> extends ObservableSnapshot<T> {
  update(mutator: (draft: T) => void): void
  set(next: T): void
}

export function createSnapshotStore<T>(initial: T): SnapshotStore<T> {
  let snapshot = initial
  const listeners = new Set<() => void>()
  const publish = (): void => {
    for (const listener of [...listeners]) listener()
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    update: (mutator) => {
      const draft = structuredClone(snapshot)
      mutator(draft)
      snapshot = draft
      publish()
    },
    set: (next) => {
      snapshot = next
      publish()
    },
  }
}

type ActionMap<State> = Readonly<Record<string, (draft: State, ...args: never[]) => void>>

export interface EngineStoreHandle<State, Actions extends ActionMap<State>> {
  create(): SnapshotStore<State> & {
    readonly actions: {
      readonly [Key in keyof Actions]: (...args: Parameters<Actions[Key]> extends [State, ...infer Rest] ? Rest : never) => void
    }
  }
}

export function defineStore<State, Actions extends ActionMap<State>>(spec: {
  readonly init: () => State
  readonly actions: Actions
}): EngineStoreHandle<State, Actions> {
  return {
    create() {
      const store = createSnapshotStore(spec.init())
      const actions = Object.fromEntries(Object.entries(spec.actions).map(([name, action]) => [
        name,
        (...args: never[]) => {
          store.update(draft => {
            action(draft, ...args)
          })
        },
      ])) as EngineStoreHandle<State, Actions>['create'] extends () => infer Instance
        ? Instance extends { readonly actions: infer Baked } ? Baked : never
        : never
      return Object.assign(store, { actions })
    },
  }
}

interface SlotRecord {
  readonly name: string
  readonly component: unknown
  readonly [key: string]: unknown
}

export class SlotRegistry extends Service {
  private readonly records = new Map<string, SlotRecord[]>()

  constructor(ctx: Context) {
    super(ctx, 'slots')
  }

  register(options: Readonly<Record<string, unknown>> & { readonly name: string }, component: unknown): () => void {
    const record = { ...options, component }
    const dispose = this.ctx.effect(() => {
      const entries = this.records.get(options.name) ?? []
      entries.push(record)
      this.records.set(options.name, entries)
      return () => {
        const current = this.records.get(options.name)
        if (current === undefined) return
        const index = current.indexOf(record)
        if (index >= 0) current.splice(index, 1)
      }
    }, `test-slots.register(${options.name})`)
    return () => {
      void dispose()
    }
  }

  inject(_name: string, callback: () => (() => void)): () => void {
    const dispose = this.ctx.effect(callback, 'test-slots.inject')
    return () => {
      void dispose()
    }
  }

  entries(name: string): readonly SlotRecord[] {
    return [...(this.records.get(name) ?? [])]
  }
}

export interface IWorkspaces {
  pickDirectory(): Promise<string | null>
}

export interface WorkspaceView {
  readonly workspaceId: string
  readonly title: string
  readonly path: string
  readonly sessionIds: readonly string[]
  readonly createdAt: string
  readonly updatedAt: string
}

export type SessionId = string
export type ClientContext = Context
