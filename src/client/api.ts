/**
 * Thin typed client for the plugin's own /side-chat host routes. Requests are
 * same-origin: the pane and the host webServer share one origin, so a relative
 * fetch carries whatever session cookie the shell already holds.
 * @module dsh-side-ask/api
 */

/** One side chat as the host registry reports it. */
export interface SideChatSummary {
  readonly sideSessionId: string
  readonly parentSessionId: string
  readonly createdAt: number
  readonly running: boolean
  /** Short display title derived from the side chat's first user message; '' when none yet. */
  readonly title: string
}

/** One rendered transcript row, projected by the host. */
export interface SideChatNode {
  readonly kind: 'user' | 'assistant' | 'reasoning' | 'tool' | 'tool-result' | 'error' | 'status'
  readonly seq: number
  readonly text: string
  readonly name?: string
  readonly failed?: boolean
  readonly streaming?: boolean
  readonly quote?: string
  readonly turn?: number
  readonly step?: number
}

/** One transcript poll: rows plus the two liveness flags. */
export interface SideChatTranscript {
  readonly sideSessionId: string
  readonly parentSessionId: string | null
  readonly title: string
  readonly running: boolean
  readonly parentRunning: boolean
  readonly nodes: readonly SideChatNode[]
}

/** Structured request failure surfaced to the pane. */
export class SideChatApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'SideChatApiError'
  }
}

async function request(path: string, init?: RequestInit): Promise<any> {
  const response = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
    cache: 'no-store',
  })
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new SideChatApiError(response.status, `unexpected response from ${path}`)
  }
  if (!response.ok) {
    const message = (payload as { error?: unknown })?.error
    throw new SideChatApiError(response.status, typeof message === 'string' ? message : `request to ${path} failed`)
  }
  return payload
}

/** The plugin's host API surface. */
export const sideChatApi = {
  /** Open a side chat forking a parent session; resolves the new session id. */
  open(parentSessionId: string): Promise<string> {
    return request('/side-chat/open', {
      method: 'POST',
      body: JSON.stringify({ parentSessionId }),
    }).then((payload: { sideSessionId?: unknown }) => {
      if (typeof payload.sideSessionId !== 'string') throw new SideChatApiError(500, 'open response missing sideSessionId')
      return payload.sideSessionId
    })
  },

  /** List a parent session's side chats, newest first. */
  list(parentSessionId: string): Promise<SideChatSummary[]> {
    return request(`/side-chat/list?parentSessionId=${encodeURIComponent(parentSessionId)}`)
      .then((payload: { sideChats?: unknown }) => {
        const rows = payload.sideChats
        if (!Array.isArray(rows)) throw new SideChatApiError(500, 'list response missing sideChats')
        return rows as SideChatSummary[]
      })
  },

  /**
   * The newest side chat, optionally restricted to one parent session.
   * @param parentSessionId - only report a side chat forked from this session.
   */
  latest(parentSessionId?: string): Promise<SideChatSummary | null> {
    const query = parentSessionId === undefined ? '' : `?parentSessionId=${encodeURIComponent(parentSessionId)}`
    return request(`/side-chat/latest${query}`).then((payload: { sideChat?: unknown }) => {
      const row = payload.sideChat
      if (row === null || row === undefined) return null
      return row as SideChatSummary
    })
  },

  /** Poll one side chat's transcript and liveness flags. */
  transcript(sideSessionId: string): Promise<SideChatTranscript> {
    return request(`/side-chat/transcript?sideSessionId=${encodeURIComponent(sideSessionId)}`)
      .then((payload: SideChatTranscript) => payload)
  },

  /** Send one user message into a live side agent. */
  prompt(sideSessionId: string, text: string, quote?: string): Promise<void> {
    return request('/side-chat/prompt', {
      method: 'POST',
      body: JSON.stringify({ sideSessionId, text, ...(quote === undefined ? {} : { quote }) }),
    }).then(() => undefined)
  },

  stop(sideSessionId: string): Promise<void> {
    return request('/side-chat/stop', { method: 'POST', body: JSON.stringify({ sideSessionId }) }).then(() => undefined)
  },

  closeParent(parentSessionId: string): Promise<void> {
    return request('/side-chat/close-parent', { method: 'POST', body: JSON.stringify({ parentSessionId }) }).then(() => undefined)
  },

  /** Close the live side agent and archive its session through DSH. */
  close(sideSessionId: string): Promise<void> {
    return request('/side-chat/close', {
      method: 'POST',
      body: JSON.stringify({ sideSessionId }),
    }).then(() => undefined)
  },
}
