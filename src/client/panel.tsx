/**
 * The right-sidebar pane body: a native side conversation rendered with
 * DSH's own primitives and design tokens so it reads as part of the shell
 * rather than as an overlay. All data comes from the plugin's own
 * /side-chat host routes; nothing here touches client session services.
 * @module dsh-side-ask/panel
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { MarkdownText, StateDot, TextShimmer, UserTextRun } from '@deepseek-ai/dsh-client-ui-primitives'
import { sideChatApi, SideChatApiError } from './api.ts'
import type { SideChatNode, SideChatSummary, SideChatTranscript } from './api.ts'
import { ComposerAction, MessageCopy, QuoteBubble, ReasoningNode } from './native-ui.tsx'
import { quoteDrafts } from './quote-drafts.ts'
import { ModelPicker } from './model-picker.tsx'
import type { ModelPickerServices } from './model-picker.tsx'

const LABELS = { code: { copyLabel: '复制', copiedLabel: '已复制' }, footnotes: '脚注' }
const IDLE_POLL_MS = 900
const LIVE_POLL_MS = 420
const TOOL_PREVIEW_MAX = 120

const rootStyle = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  minHeight: 0,
  minWidth: 0,
  fontFamily: 'var(--dsw-font-family)',
  fontSize: 'var(--dsh-content-font-size, 14px)',
  lineHeight: 1.65,
  color: 'var(--dsw-alias-label-primary)',
} as const

const headerStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '8px 12px',
  borderBottom: '1px solid var(--dsw-alias-border-l1)',
  flex: '0 0 auto',
} as const

const statusGroupStyle = { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 } as const
const statusTextStyle = { fontSize: 'var(--dsh-content-font-size-secondary, 13px)', color: 'var(--dsw-alias-label-secondary)', flex: '0 0 auto' } as const
const titleStyle = {
  fontSize: 'var(--dsh-content-font-size-secondary, 13px)',
  color: 'var(--dsw-alias-label-tertiary)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
} as const

const bodyStyle = {
  flex: '1 1 auto',
  minHeight: 0,
  overflowY: 'auto',
  overflowX: 'hidden',
  padding: '10px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
} as const

const userRowStyle = {
  alignSelf: 'flex-end',
  maxWidth: '86%',
  padding: '6px 10px',
  borderRadius: 'var(--dsw-radius-lg)',
  background: 'var(--dsw-alias-bg-layer-2)',
  color: 'var(--dsw-alias-label-primary)',
  whiteSpace: 'break-spaces',
  wordBreak: 'break-word',
} as const

const toolRowStyle = {
  border: '1px solid var(--dsw-alias-border-l1)',
  borderRadius: 'var(--dsw-radius-sm)',
  background: 'var(--dsw-alias-bg-layer-1)',
  padding: '4px 8px',
  cursor: 'pointer',
} as const

const toolHeadStyle = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 6,
  fontSize: 'var(--dsh-content-font-size-secondary, 13px)',
  color: 'var(--dsw-alias-label-tertiary)',
  minWidth: 0,
} as const

const toolNameStyle = { color: 'var(--dsw-alias-label-secondary)', flex: '0 0 auto' } as const
const toolPreviewStyle = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 } as const
const preStyle = {
  margin: '4px 0 0',
  fontFamily: 'var(--ds-font-family-code)',
  fontSize: 'var(--dsh-code-font-size, 11px)',
  color: 'var(--dsw-alias-label-secondary)',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
  maxHeight: 220,
  overflow: 'auto',
} as const

const emptyStyle = {
  margin: 'auto',
  maxWidth: 260,
  textAlign: 'center',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  alignItems: 'center',
  color: 'var(--dsw-alias-label-tertiary)',
  fontSize: 'var(--dsh-content-font-size-secondary, 13px)',
  lineHeight: 1.6,
} as const

const composerStyle = {
  flex: '0 0 auto',
  padding: '12px',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
} as const

const textareaStyle = {
  border: 'none',
  outline: 'none',
  resize: 'none',
  background: 'transparent',
  color: 'var(--dsw-alias-label-primary)',
  fontFamily: 'var(--dsw-font-family)',
  fontSize: 'inherit',
  lineHeight: 1.5,
  minHeight: 40,
  maxHeight: 160,
  width: '100%',
  boxSizing: 'border-box',
} as const

const hintStyle = { fontSize: 'var(--dsh-content-font-size-secondary, 13px)', color: 'var(--dsw-alias-label-tertiary)' } as const
const errorStyle = { fontSize: 'var(--dsh-content-font-size-secondary, 13px)', color: 'var(--dsw-alias-state-error-primary)', overflowWrap: 'anywhere' } as const

interface ToolNodeProps {
  readonly node: SideChatNode
}

function ToolNode({ node }: ToolNodeProps) {
  const [open, setOpen] = useState(false)
  const flat = node.text.replace(/\s+/g, ' ').trim()
  const preview = flat.length > TOOL_PREVIEW_MAX ? flat.slice(0, TOOL_PREVIEW_MAX) + '…' : flat
  return (
    <details style={toolRowStyle} open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary style={toolHeadStyle}>
        <span style={toolNameStyle}>{node.name === undefined || node.name === '' ? '工具' : node.name}</span>
        <span style={toolPreviewStyle}>{open ? '' : preview}</span>
      </summary>
      {open ? <pre style={preStyle}>{node.text}</pre> : null}
    </details>
  )
}

interface SidePaneProps extends ModelPickerServices {
  /** Session the pane was opened for, injected by the sidebar-right seat. */
  readonly sessionId?: string
  readonly useTabInfo?: () => { tab: { visible: boolean; signal: AbortSignal } }
}

/**
 * Render the side conversation for the session that owns the pane.
 * @param props.sessionId - parent session id supplied by the slot standard props.
 */
export function SidePane(props: SidePaneProps) {
  const parentSessionId = typeof props.sessionId === 'string' ? props.sessionId : undefined
  const tabInfo = props.useTabInfo?.()
  const quote = useSyncExternalStore(quoteDrafts.subscribe, () => quoteDrafts.get(parentSessionId), () => undefined)
  const [sideChat, setSideChat] = useState<SideChatSummary | null>(null)
  const [transcript, setTranscript] = useState<SideChatTranscript | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [openModelOnReady, setOpenModelOnReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const sendingRef = useRef(false)
  const followScroll = useRef(true)
  const sideSessionId = sideChat === null ? undefined : sideChat.sideSessionId

  const ensureSideChat = useCallback(async (): Promise<string> => {
    if (sideSessionId !== undefined) return sideSessionId
    if (parentSessionId === undefined) throw new Error('当前会话缺少 id，无法开启旁问')
    const target = await sideChatApi.open(parentSessionId)
    if (tabInfo?.tab.signal.aborted) {
      await sideChatApi.close(target)
      throw new Error('旁问已关闭')
    }
    setSideChat({ sideSessionId: target, parentSessionId, createdAt: Date.now(), running: false, title: '' })
    return target
  }, [sideSessionId, parentSessionId, tabInfo?.tab.signal])

  const openModel = useCallback(async (): Promise<void> => {
    if (sendingRef.current || tabInfo?.tab.signal.aborted) return
    sendingRef.current = true
    setBusy(true)
    setError(null)
    try { setOpenModelOnReady(true); await ensureSideChat() }
    catch (failure) { setOpenModelOnReady(false); setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false); sendingRef.current = false }
  }, [ensureSideChat, tabInfo?.tab.signal])

  const modelOpened = useCallback(() => setOpenModelOnReady(false), [])

  useEffect(() => {
    let alive = true
    let timer = 0
    const tick = async (): Promise<void> => {
      try {
        if (sideSessionId === undefined) {
          if (parentSessionId === undefined) return
          const row = await sideChatApi.latest(parentSessionId)
          if (alive) {
            setSideChat(row)
            setTranscript(null)
            setError(null)
          }
        } else {
          const snapshot = await sideChatApi.transcript(sideSessionId)
          if (alive) {
            setTranscript(snapshot)
            setSideChat((previous) =>
              previous === null
                ? previous
                : { ...previous, running: snapshot.running, title: snapshot.title === '' ? previous.title : snapshot.title },
            )
            setError(null)
          }
        }
      } catch (failure) {
        if (alive) {
          if (failure instanceof SideChatApiError && failure.status === 404) {
            setSideChat(null)
            setTranscript(null)
            setError(null)
          } else {
            setError(failure instanceof Error ? failure.message : String(failure))
          }
        }
      } finally {
        if (alive) timer = window.setTimeout(tick, sideSessionId === undefined ? IDLE_POLL_MS : LIVE_POLL_MS)
      }
    }
    void tick()
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [parentSessionId, sideSessionId])

  const tailText = transcript?.nodes.at(-1)?.text
  const nodeCount = transcript?.nodes.length ?? 0
  useEffect(() => {
    const scroller = scrollerRef.current
    if (scroller !== null && followScroll.current) scroller.scrollTop = scroller.scrollHeight
  }, [nodeCount, tailText])

  useEffect(() => {
    if (tabInfo?.tab.visible !== false) inputRef.current?.focus({ preventScroll: true })
  }, [tabInfo?.tab.visible, quote])

  const send = useCallback(async (): Promise<void> => {
    const text = draft.trim() || (quote === undefined ? '' : '请解释引用的这段内容。')
    if (text === '' || sendingRef.current || tabInfo?.tab.signal.aborted) return
    sendingRef.current = true
    setBusy(true)
    setError(null)
    try {
      const target = await ensureSideChat()
      await sideChatApi.prompt(target, text, quote)
      setDraft('')
      if (parentSessionId !== undefined && quoteDrafts.get(parentSessionId) === quote) quoteDrafts.set(parentSessionId)
      followScroll.current = true
      if (inputRef.current !== null) inputRef.current.style.height = ''
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
      sendingRef.current = false
    }
  }, [draft, quote, parentSessionId, ensureSideChat, tabInfo?.tab.signal])

  const stop = useCallback(async (): Promise<void> => {
    if (sideSessionId === undefined) return
    try { await sideChatApi.stop(sideSessionId) }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
  }, [sideSessionId])

  const running = transcript !== null && transcript.running
  const parentRunning = transcript !== null && transcript.parentRunning
  const nodes: readonly SideChatNode[] = transcript === null ? [] : transcript.nodes
  const title = sideChat === null ? '' : sideChat.title

  return (
    <div style={rootStyle} data-dsh-side-ask-pane="" onKeyDown={(event) => {
      if (event.key !== 'Escape' || event.nativeEvent.isComposing) return
      event.stopPropagation()
      if (running) void stop()
    }}>
      <div style={headerStyle}>
        <div style={statusGroupStyle}>
          <StateDot state={running ? 'ongoing' : sideChat === null ? 'idle' : 'done'} />
          {running ? (
            <TextShimmer active>
              <span style={statusTextStyle}>思考中</span>
            </TextShimmer>
          ) : (
            <span style={statusTextStyle}>{sideChat === null ? '未开启' : '就绪'}</span>
          )}
          {parentRunning && !running ? <span style={hintStyle}>· 主对话运行中</span> : null}
          {title === '' ? null : <span style={titleStyle}>{title}</span>}
        </div>
      </div>
      <div style={bodyStyle} ref={scrollerRef} role="log" aria-label="旁问对话" onScroll={(event) => {
        const el = event.currentTarget
        followScroll.current = el.scrollHeight - el.scrollTop - el.clientHeight < 72
      }}>
        {nodes.length === 0 ? (
          <div style={emptyStyle}>
            <span style={{ color: 'var(--dsw-alias-label-primary)', fontWeight: 500 }}>有什么想顺便问的？</span>
            <span>沿用主对话上下文，随时追问。</span>
          </div>
        ) : (
          nodes.map((node) =>
            node.kind === 'user' ? (
              <div key={node.seq} style={userRowStyle}>
                {node.quote === undefined ? null : <QuoteBubble text={node.quote} />}
                <UserTextRun text={node.text} />
              </div>
            ) : node.kind === 'assistant' ? (
              <div key={node.seq}>
                <MarkdownText text={node.text} streaming={node.streaming} labels={LABELS} />
                {node.streaming ? null : <MessageCopy text={node.text} onError={setError} />}
              </div>
            ) : node.kind === 'reasoning' ? (
              <ReasoningNode key={`reasoning-${node.turn ?? node.seq}-${node.step ?? 0}`} text={node.text} running={node.streaming} />
            ) : node.kind === 'tool' ? (
              <ToolNode key={node.seq} node={node} />
            ) : node.failed === true ? (
              <div key={node.seq} style={errorStyle}>
                {node.text}
              </div>
            ) : node.kind === 'status' ? <div key={node.seq} style={hintStyle}>{node.text}</div> : null,
          )
        )}
      </div>
      <div style={composerStyle}>
        {error === null ? null : <div style={errorStyle}>{error}</div>}
        <div className="dsh-side-card">
          {quote === undefined ? null : <QuoteBubble text={quote} onRemove={() => { if (parentSessionId !== undefined) quoteDrafts.set(parentSessionId) }} />}
          <textarea
            ref={inputRef}
            aria-label="旁问输入"
            value={draft}
            rows={2}
            style={textareaStyle}
            placeholder="问点什么"
            onChange={(event) => {
              setDraft(event.target.value)
              event.currentTarget.style.height = 'auto'
              event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 160)}px`
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
                event.preventDefault()
                void send()
              }
            }}
          />
          <ComposerAction running={running} hasDraft={draft.trim() !== '' || quote !== undefined} busy={busy} onSend={() => void send()} onStop={() => void stop()}
            modelPicker={<ModelPicker sessionId={sideSessionId} busy={busy} activate={() => void openModel()} openOnReady={openModelOnReady} onOpened={modelOpened} onError={setError}
              retainModelSession={props.retainModelSession} nativeModelMenu={props.nativeModelMenu} />} />
        </div>
      </div>
    </div>
  )
}
