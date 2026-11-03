import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { DisclosureRow, MarkdownText, TextShimmer, Tooltip, IconThinkOutlineRegular, IconCopyOutlineRegular, IconCheckOutlineRegular, IconCloseOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'

const LABELS = { code: { copyLabel: '复制', copiedLabel: '已复制' }, footnotes: '脚注' }

export function QuoteBubble({ text, onRemove }: { text: string; onRemove?: () => void }) {
  return <div className="dsh-side-quote" aria-label="引用的主对话文字">
    <div className="dsh-side-quote-content"><span className="dsh-side-quote-label">引用主对话</span><div className="dsh-side-quote-text">{text}</div></div>
    {onRemove === undefined ? null : <Tooltip label="移除引用" side="top"><button type="button" className="dsh-side-action" aria-label="移除引用" onClick={onRemove}><IconCloseOutlineRegular /></button></Tooltip>}
  </div>
}

export function ReasoningNode({ text, running = false }: { text: string; running?: boolean }) {
  const [open, setOpen] = useState(false)
  const preview = text.replace(/\*\*/g, '').split('\n').find(line => line.trim() !== '') ?? ''
  return <div className="dsh-side-reasoning" data-side-reasoning="" data-streaming={running || undefined}>
    <DisclosureRow icon={<IconThinkOutlineRegular size={14} />} title="思考过程" open={open}
      expandable={text !== ''} onToggle={() => setOpen(value => !value)} running={running} expandOnRowClick
      collapsedContent={open || preview === '' ? undefined : <span className="dsh-side-reasoning-preview"><TextShimmer active={running}>{preview}</TextShimmer></span>}>
      {open && text !== '' ? <div className="dsh-side-reasoning-body"><MarkdownText text={text} streaming={running} labels={LABELS} variant="compact" /></div> : null}
    </DisclosureRow>
  </div>
}

export function MessageCopy({ text, onError }: { text: string; onError: (message: string) => void }) {
  const [copied, setCopied] = useState(false)
  return <div className="dsh-side-message-actions"><Tooltip label={copied ? '已复制' : '复制'} side="bottom">
    <button type="button" className="dsh-side-action" aria-label={copied ? '已复制' : '复制'} onClick={() => {
      void navigator.clipboard.writeText(text).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1000) }).catch(() => onError('复制失败，请手动选择文字复制'))
    }}>{copied ? <IconCheckOutlineRegular /> : <IconCopyOutlineRegular />}</button>
  </Tooltip></div>
}

export function ComposerAction({ running, hasDraft, busy, onSend, onStop, modelPicker }: {
  running: boolean; hasDraft: boolean; busy: boolean; onSend: () => void; onStop: () => void; modelPicker?: ReactNode
}) {
  const stopping = running && !hasDraft
  const rowRef = useRef<HTMLDivElement | null>(null)
  const [clearance, setClearance] = useState(0)
  useEffect(() => {
    // Floating DSH pets can cover a right-aligned control; keep the native
    // control reachable without changing the user's pet or its position.
    const measure = () => {
      const row = rowRef.current
      const button = row?.querySelector('button')
      if (row === null || row === undefined || button === null || button === undefined) return
      const rect = row.getBoundingClientRect()
      const action = button.getBoundingClientRect()
      if (rect.width < 40 || action.height === 0) return
      const top = document.elementFromPoint(rect.right - 17, action.top + action.height / 2)
      if (top === null || row.closest('.dsh-side-card')?.contains(top)) { setClearance(0); return }
      let obstacle = top.getBoundingClientRect()
      for (let parent = top.parentElement; parent !== null; parent = parent.parentElement) {
        const bounds = parent.getBoundingClientRect()
        if (bounds.width > Math.min(260, rect.width * .75) || bounds.height > 300 || parent.contains(row)) break
        if (bounds.width >= obstacle.width && bounds.height >= obstacle.height) obstacle = bounds
      }
      setClearance(Math.max(0, Math.min(rect.width - 42, rect.right - obstacle.left + 8)))
    }
    measure()
    const timer = window.setInterval(measure, 600)
    window.addEventListener('resize', measure)
    return () => { window.clearInterval(timer); window.removeEventListener('resize', measure) }
  }, [])
  const stopIcon = <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="3" width="10" height="10" rx="3" fill="currentColor" /></svg>
  return <div className="dsh-side-composer-actions" ref={rowRef} style={{ paddingInlineEnd: clearance }}>
    {modelPicker}
    {running && hasDraft ? <Tooltip label="停止生成" side="top"><button type="button" className="dsh-side-primary" aria-label="停止生成" onMouseDown={event => event.preventDefault()} onClick={onStop}>{stopIcon}</button></Tooltip> : null}
    <Tooltip label={stopping ? '停止生成' : '发送消息'} side="top"><button type="button" className="dsh-side-primary" aria-label={stopping ? '停止生成' : '发送消息'}
      disabled={busy || (!hasDraft && !running)} onMouseDown={event => event.preventDefault()} onClick={stopping ? onStop : onSend}>
      {stopping ? stopIcon : <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8.3125 0.980183C8.66767 1.0531 8.97902 1.20418 9.2627 1.43233C9.48724 1.61297 9.73029 1.85793 9.97949 2.10714L14.707 6.83468L13.293 8.24874L9 3.95577V15.0417H7V3.95577L2.70703 8.24874L1.29297 6.83468L6.02051 2.10714C6.26971 1.85793 6.51277 1.61297 6.7373 1.43233C6.97662 1.23986 7.28445 1.04402 7.6875 0.980183C7.8973 0.947006 8.1031 0.95516 8.3125 0.980183Z" fill="currentColor" /></svg>}
    </button></Tooltip>
  </div>
}

export const SIDE_STYLES = `
.dsh-side-card{box-sizing:border-box;width:100%;--dsw-elevation-stroke-color:var(--dsw-alias-border-l2);border:0;border-radius:var(--dsw-radius-panel);background:var(--dsw-specific-input-major);box-shadow:var(--dsw-elevation-soft);font-size:var(--dsh-content-font-size,14px);line-height:calc(24px + var(--dsh-content-font-delta,0px));display:flex;flex-direction:column;gap:12px;padding:10px 12px 6px}
.dsh-side-card textarea::placeholder{color:var(--dsw-alias-label-caption)}
.dsh-side-card textarea:focus-visible{outline:none}
.dsh-side-composer-actions{display:flex;justify-content:flex-end;align-items:center;gap:8px;min-width:0;padding:2px 0 0}
.dsh-side-model{margin-inline-end:auto;min-width:0;flex:0 1 auto;max-width:calc(100% - 42px)}
.dsh-side-model-inherit{display:inline-flex;align-items:center;gap:6px;max-width:100%;padding:6px 8px;border:0;border-radius:var(--dsw-radius-md);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:var(--dsh-content-font-size-secondary,13px);cursor:pointer}
.dsh-side-model-inherit:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dsh-side-model-inherit:disabled{cursor:default;opacity:.6}.dsh-side-model-inherit span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-side-model-inherit svg{flex:none}
.dsh-side-primary{corner-shape:round;background:var(--dsw-alias-button-info-fill);color:#fff;cursor:pointer;border:none;border-radius:999px;flex:none;place-items:center;width:34px;height:34px;transition:background-color .1s;display:grid;transform:translateY(-2px)}
.dsh-side-primary:hover:not(:disabled){background:var(--dsw-alias-button-info-hover)}
.dsh-side-primary:disabled{opacity:.4;cursor:default}
.dsh-side-action{width:calc(28px + var(--dsh-content-font-delta,0px));height:calc(28px + var(--dsh-content-font-delta,0px));border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-tertiary);cursor:pointer;background:transparent;border:none;display:inline-flex;justify-content:center;align-items:center;padding:6px;flex:none}
.dsh-side-action svg{width:calc(15px + var(--dsh-content-font-delta,0px));height:calc(15px + var(--dsh-content-font-delta,0px))}
.dsh-side-action:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.dsh-side-message-actions{display:flex;align-items:center;gap:8px;margin:8px 0 0 -6px}
.dsh-side-quote{display:flex;align-items:flex-start;gap:8px;min-width:0;padding:8px 10px;border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);border-left:2px solid var(--dsw-alias-border-l2)}
.dsh-side-quote-content{flex:1;min-width:0}.dsh-side-quote-label{display:block;color:var(--dsw-alias-label-tertiary);font-size:var(--dsh-content-font-size-secondary,13px);margin-bottom:2px}
.dsh-side-quote-text{max-height:84px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font-size:var(--dsh-content-font-size-secondary,13px);line-height:1.6}
.dsh-side-reasoning{min-width:0;color:var(--dsw-alias-label-tertiary)}
.dsh-side-reasoning-preview{display:block;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:var(--dsh-content-font-size-secondary,13px);margin-left:8px;font-weight:400}
.dsh-side-reasoning-body{padding:4px 0 4px calc(22px + var(--dsh-content-font-delta,0px));min-width:0}
.dsh-side-selection{position:fixed;z-index:90;display:flex;max-width:calc(100vw - 16px);padding:4px;background:var(--dsw-specific-menu);box-shadow:var(--dsw-elevation-panel);border-radius:var(--dsw-radius-lg);backdrop-filter:var(--dsw-menu-backdrop-filter);font-family:var(--dsw-font-family)}
`
