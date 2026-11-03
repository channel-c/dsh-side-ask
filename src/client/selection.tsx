import { createRoot } from 'react-dom/client'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { quoteDrafts } from './quote-drafts.ts'

interface Sidebar {
  mounted: { getSnapshot(): string | undefined; subscribe?(listener: () => void): () => void }
  openTab(kind: string): unknown
}

export function installSelectionAction(sidebar: Sidebar): () => void {
  const host = document.createElement('div')
  host.dataset.dshSideSelection = ''
  document.body.appendChild(host)
  const root = createRoot(host)
  let frame = 0
  let selected: { parent: string; text: string; x: number; y: number } | undefined
  const hide = () => { selected = undefined; root.render(null) }
  const update = () => {
    const selection = window.getSelection()
    const parent = sidebar.mounted.getSnapshot()
    const elementOf = (node: Node | null) => node instanceof Element ? node : node?.parentElement
    const anchor = elementOf(selection?.anchorNode ?? null)
    const focus = elementOf(selection?.focusNode ?? null)
    const area = anchor?.closest('[data-conversation-scroll]')
    const text = selection?.toString().trim() ?? ''
    if (parent === undefined || selection === null || selection.isCollapsed || selection.rangeCount !== 1 || text === ''
      || area === null || area === undefined || !area.contains(focus ?? null)
      || anchor?.closest('[data-dsh-side-ask-pane],input,textarea,[contenteditable="true"],[data-composer-card]')
      || focus?.closest('[data-dsh-side-ask-pane],input,textarea,[contenteditable="true"],[data-composer-card]')) { hide(); return }
    const rect = selection.getRangeAt(0).getBoundingClientRect()
    if (rect.width === 0 || rect.bottom < 0 || rect.top > window.innerHeight) { hide(); return }
    selected = { parent, text, x: Math.max(8, Math.min(rect.left, window.innerWidth - 160)), y: rect.top >= 48 ? rect.top - 42 : rect.bottom + 8 }
    const quote = selected
    root.render(<div className="dsh-side-selection" role="toolbar" aria-label="选中文字操作" style={{ left: quote.x, top: quote.y }} onMouseDown={event => event.preventDefault()}>
      <Button size="sm" variant="toolbar" onClick={() => {
        if (sidebar.mounted.getSnapshot() !== quote.parent) { hide(); return }
        quoteDrafts.set(quote.parent, quote.text)
        sidebar.openTab('side-chat')
        window.getSelection()?.removeAllRanges()
        hide()
      }}>发送到旁问</Button>
    </div>)
  }
  const schedule = () => { window.cancelAnimationFrame(frame); frame = window.requestAnimationFrame(update) }
  document.addEventListener('selectionchange', schedule)
  document.addEventListener('pointerup', schedule)
  document.addEventListener('keyup', schedule)
  window.addEventListener('scroll', hide, true)
  window.addEventListener('resize', hide)
  const unsubscribe = sidebar.mounted.subscribe?.(hide)
  return () => {
    window.cancelAnimationFrame(frame)
    document.removeEventListener('selectionchange', schedule)
    document.removeEventListener('pointerup', schedule)
    document.removeEventListener('keyup', schedule)
    window.removeEventListener('scroll', hide, true)
    window.removeEventListener('resize', hide)
    unsubscribe?.(); root.unmount(); host.remove()
  }
}
