const quotes = new Map<string, string>()
const listeners = new Set<() => void>()

export const quoteDrafts = {
  get(parent?: string): string | undefined { return parent === undefined ? undefined : quotes.get(parent) },
  set(parent: string, text?: string): void {
    if (text === undefined || text === '') quotes.delete(parent)
    else quotes.set(parent, text)
    for (const listener of listeners) listener()
  },
  subscribe(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } },
}
