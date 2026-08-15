import type { Context } from '@deepseek-ai/cordis'

export function makeTranslate(...dictionaries: readonly Readonly<Record<string, string>>[]) {
  return (key: string, params: Readonly<Record<string, unknown>> = {}): string => {
    const template = dictionaries.find(dictionary => dictionary[key] !== undefined)?.[key] ?? key
    return template.replace(/\{([^}]+)\}/g, (_match, name: string) => String(params[name] ?? `{${name}}`))
  }
}

export class TestRemote {
  private readonly listeners = new Map<string, Set<(...args: never[]) => void>>()

  constructor(ctx: Context) {
    ctx.provide('remote', this as never)
  }

  $dispatch(event: string, args: readonly unknown[]): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener(...args as never[])
  }

  $on(event: string, listener: (...args: never[]) => void): () => void {
    const listeners = this.listeners.get(event) ?? new Set()
    listeners.add(listener)
    this.listeners.set(event, listeners)
    return () => {
      listeners.delete(listener)
    }
  }

  async $mount(): Promise<() => Promise<void>> {
    return async () => {}
  }
}
