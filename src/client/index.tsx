import { createElement } from 'react'
import type { ComponentType, ReactNode } from 'react'
import { SidePane } from './panel.tsx'
import { sideChatApi } from './api.ts'
import { SIDE_STYLES } from './native-ui.tsx'
import { installSelectionAction } from './selection.tsx'
import { quoteDrafts } from './quote-drafts.ts'
import type { ModelSessionReference } from './model-picker.tsx'

export const name = 'dsh-side-codex'
export const TAB_KIND = 'side-chat'
export const inject = ['slots', 'sidebarRightTabs', 'sidebarRight', 'sessions', 'locale']

interface NativeEntry {
  component: ComponentType<any>
  locale?: string
  inject?: (sessionId: string) => Record<string, unknown>
}

interface ClientContext {
  sessions: { retain(sessionId: string, options: { source: string }): ModelSessionReference }
  locale: { bind(namespace: string): (key: string, params?: unknown) => string }
  sidebarRightTabs: { register(definition: Record<string, unknown>): () => void }
  sidebarRight: {
    mounted: { getSnapshot(): string | undefined }
    openTab(kind: string): unknown
    registerCloseHandler(kind: string, handler: (sessionId: string) => void): () => void
  }
  slots: {
    entriesOfSlot(key: string): readonly NativeEntry[]
    subscribe(key: string, listener: () => void): () => void
    getVersion(key: string): number
    inject(seat: string, register: () => unknown): () => void
    register(seat: Record<string, unknown>, component: (props: any) => ReactNode): unknown
  }
  effect(run: () => () => void, label?: string): void
}

export function apply(ctx: ClientContext): void {
  const retainModelSession = (sessionId: string) => ctx.sessions.retain(sessionId, { source: 'side-chat:model-picker' })
  // Slot declarations belong to exactly one owner. Reuse the shipped
  // component and its public session-bound business face without declaring
  // or shadowing conversation.input.model in the main composer.
  const nativeModelMenu = {
    subscribe: (listener: () => void) => ctx.slots.subscribe('conversation.input.model', listener),
    version: () => ctx.slots.getVersion('conversation.input.model'),
    bind: (sessionId: string) => {
      const entry = ctx.slots.entriesOfSlot('conversation.input.model')[0]
      if (entry === undefined || entry.inject === undefined || entry.locale === undefined) return undefined
      return { Component: entry.component, props: {
        ...entry.inject(sessionId), t: ctx.locale.bind(entry.locale),
        renderSlot: (_key: string, owner: Record<string, unknown>, options?: { fallback?: ReactNode }) => {
          const label = ctx.slots.entriesOfSlot('conversation.input.model.label')[0]
          if (label === undefined) return options?.fallback ?? null
          return createElement(label.component, { ...owner, ...label.inject?.(sessionId),
            ...(label.locale === undefined ? {} : { t: ctx.locale.bind(label.locale) }) })
        },
      } }
    },
  }
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const style = document.createElement('style')
    style.dataset.pluginCss = 'dsh-side-codex/native-ui'
    style.textContent = SIDE_STYLES
    document.head.appendChild(style)
    return () => style.remove()
  }, 'side-chat: native styles')
  ctx.effect(() => typeof document === 'undefined' ? () => {} : installSelectionAction(ctx.sidebarRight), 'side-chat: selected text')
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: TAB_KIND,
    kind: TAB_KIND,
    title: () => '侧边对话',
    keepMounted: true,
    guide: [{ order: 40, title: () => '侧边对话', description: () => '沿用主对话上下文，随时追问' }],
  }), 'side-chat: native tab')

  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () =>
    ctx.slots.register({ name: 'sidebar.right.pane.tab', key: TAB_KIND },
      props => createElement(SidePane, { ...props, retainModelSession, nativeModelMenu })),
  ), 'side-chat: native pane')

  ctx.effect(() => ctx.sidebarRight.registerCloseHandler(TAB_KIND, sessionId => {
    quoteDrafts.set(sessionId)
    void sideChatApi.closeParent(sessionId).catch(error => console.warn('旁问清理失败', error))
  }), 'side-chat: tab close cleanup')

  ctx.effect(() => {
    let alive = true
    let timer = 0
    const seen = new Set<string>()
    const tick = async (): Promise<void> => {
      try {
        const parent = ctx.sidebarRight.mounted.getSnapshot()
        if (parent === undefined) return
        const row = await sideChatApi.latest(parent)
        if (!alive || row === null || seen.has(row.sideSessionId)) return
        if (ctx.sidebarRight.mounted.getSnapshot() !== parent) return
        ctx.sidebarRight.openTab(TAB_KIND)
        seen.add(row.sideSessionId)
      } catch {
        // Retry after host startup or reconnect.
      } finally {
        if (alive) timer = window.setTimeout(() => void tick(), 700)
      }
    }
    timer = window.setTimeout(() => void tick(), 700)
    return () => { alive = false; window.clearTimeout(timer) }
  }, 'side-chat: command reveal')
}
