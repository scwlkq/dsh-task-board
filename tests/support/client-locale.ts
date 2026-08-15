import type { Context } from '@deepseek-ai/cordis'

export class LocaleRuntime {
  private locale = 'en'
  private readonly dictionaries = new Map<string, unknown>()

  constructor(_ctx: Context) {}

  setLocale(locale: string): void {
    this.locale = locale
  }

  register(namespace: string, dictionaries: unknown): () => void {
    this.dictionaries.set(namespace, dictionaries)
    return () => {
      this.dictionaries.delete(namespace)
    }
  }

  getLocale(): string {
    return this.locale
  }
}
