import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ComponentType } from 'react'
import { IconDataOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'

/** An owned reference from DSH's client Session Controller. */
export interface ModelSessionReference {
  readonly sessionId: string
  readonly binding: unknown
  readonly ready: Promise<unknown>
  release(): void
}

/** Framework faces passed down from the registered sidebar slot. */
export interface ModelPickerServices {
  readonly retainModelSession: (sessionId: string) => ModelSessionReference
  readonly nativeModelMenu: {
    subscribe(listener: () => void): () => void
    version(): number
    bind(sessionId: string): { Component: ComponentType<any>; props: Record<string, unknown> } | undefined
  }
}

export function ModelPicker({ sessionId, busy, activate, openOnReady, onOpened, onError, ...services }: ModelPickerServices & {
  sessionId?: string
  busy: boolean
  activate(): void
  openOnReady: boolean
  onOpened(): void
  onError(message: string): void
}) {
  const [reference, setReference] = useState<ModelSessionReference>()
  const root = useRef<HTMLDivElement>(null)
  const [retry, setRetry] = useState(0)
  const [failed, setFailed] = useState(false)
  const { retainModelSession, nativeModelMenu } = services
  const version = useSyncExternalStore(nativeModelMenu.subscribe, nativeModelMenu.version, nativeModelMenu.version)
  const menu = useMemo(() => reference?.sessionId === sessionId && reference !== undefined
    ? nativeModelMenu.bind(reference.sessionId) : undefined, [reference, sessionId, nativeModelMenu, version])

  useEffect(() => {
    setReference(undefined)
    setFailed(false)
    if (sessionId === undefined) return
    let alive = true
    let retained: ModelSessionReference | undefined
    let timer = 0
    const started = Date.now()
    const acquire = () => {
      try {
        retained = retainModelSession(sessionId)
        void retained.ready.then(() => {
          if (alive) setReference(retained)
        }, error => {
          if (alive) { setFailed(true); onError(error instanceof Error ? error.message : String(error)) }
        })
      } catch (error) {
        // The HTTP creation reply may arrive just before the native catalog
        // event. Wait for that event without ever binding to the parent.
        if (Date.now() - started < 8000) timer = window.setTimeout(acquire, 180)
        else if (alive) { setFailed(true); onError(error instanceof Error ? error.message : String(error)) }
      }
    }
    acquire()
    return () => { alive = false; window.clearTimeout(timer); retained?.release() }
  }, [sessionId, retainModelSession, onError, retry])

  useEffect(() => {
    if (reference === undefined || reference.sessionId !== sessionId || !openOnReady) return
    const frame = window.requestAnimationFrame(() => {
      const trigger = root.current?.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')
      if (trigger === undefined || trigger === null) return
      if (trigger.getAttribute('aria-expanded') !== 'true') trigger.click()
      onOpened()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [reference, sessionId, openOnReady, onOpened, menu])

  const ready = reference !== undefined && reference.sessionId === sessionId
  return <div className="dsh-side-model" ref={root} data-side-model-session={ready ? sessionId : undefined}>
    {ready && menu !== undefined ? <menu.Component {...menu.props} locked={busy} />
      : <button type="button" className="dsh-side-model-inherit" aria-label={failed ? '重试加载旁问模型' : '设置旁问模型'}
        disabled={busy || (sessionId !== undefined && !failed)}
        onClick={() => { if (failed) setRetry(value => value + 1); else activate() }}>
        <IconDataOutlineRegular size={16} /><span>{failed ? '重试加载模型' : sessionId === undefined ? '继承主对话' : '加载模型…'}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="m3 4.5 3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
      </button>}
  </div>
}
