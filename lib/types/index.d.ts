/**
 * dsh-side-ask host half: native `/side` side conversations.
 *
 * A side chat is a fork of the parent session — same completed-turn prefix as
 * a model-visible fork, same agent preset composition — created as an ordinary
 * live Agent under the parent's workspace. It is NOT shown as the active
 * conversation: the plugin keeps a small registry (sideSessionId → parent) so
 * the GUI can group side chats under their parent and open them in the
 * native right sidebar, while the main task keeps running independently.
 *
 * Message posting targets only registered side agents through their native
 * followup API. The plugin owns the /side-chat lifecycle routes and exposes
 * the /side command as a keyboard entry point.
 *
 * Security note: the routes are served through the same webServer as /api and
 * must be reachable only from the trusted web client. They are thin — they
 * take a sessionId and an optional prompt and delegate to existing host
 * services; there is no new capability a malicious caller gains beyond
 * forking sessions it could already fork.
 *
 * @module dsh-side-ask
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { ModelSelection } from '@deepseek-ai/dsh-agent';
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session';
export { ROUTE_PREFIX, SIDE_ALIAS, SIDE_COMMAND, PLUGIN_ID } from './invariant.ts';
/** Plugin identity for cordis.yml rows. */
export declare const name = "dsh-side-ask";
/** Services required before mounting. */
export declare const inject: string[];
/** Plugin config. */
export interface Config {
    /** Human-readable description shown in command discovery UI. */
    description: string;
}
export declare const Config: z<Config>;
/** One registry record: a side session and its owning parent. */
export interface SideChatSummary {
    readonly sideSessionId: SessionId;
    readonly parentSessionId: SessionId;
    readonly createdAt: number;
    /** Whether the side agent is mid-turn right now. */
    readonly running: boolean;
    /** Short display title derived from the side chat's first user message. */
    readonly title: string;
}
/**
 * The balanced completed-turn prefix of a session's log, extended through
 * trailing out-of-band appends up to the next turn/start — the same seed the
 * host's `session.fork` computes, so a side chat inherits exactly the context
 * a fork would.
 */
export declare function sideChatSeed(parent: Session): readonly import('@deepseek-ai/dsh-session').SessionEvent[] | undefined;
/** Preserve accepted history while keeping the parent's pending work out of the child. */
export declare function sideChatForkSeed(source: readonly SessionEvent[], modelSelection?: ModelSelection): SessionEvent[];
/** Maximum length of a derived side-chat title (approximate, CJK-aware). */
export declare const SIDE_CHAT_TITLE_MAX = 24;
/**
 * Derive a short display title for a side chat from its OWN first user
 * message — DSH's title system deliberately skips sessions with a parent, so
 * side chats carry no title; this is a deterministic, recomputable label.
 *
 * The side session's log is seeded with the parent's completed-turn prefix,
 * so the boundary (`seedLength`) must be excluded: the title must come from
 * the question the user actually asked IN the side chat, never an inherited
 * parent message.
 * @param session - the side session.
 * @returns the truncated first-message text, or undefined when the session
 *   has no own user message yet.
 */
export declare function sideChatTitleOf(session: Session): string | undefined;
/**
 * Plugin body: installs the /side-chat routes, the durable (in-process)
 * side-chat registry, and the /side human command.
 * @param ctx - the host root context.
 * @param config - validated plugin config.
 */
/** One rendered row of the side-chat transcript projection. */
export interface SideChatNode {
    readonly kind: 'user' | 'assistant' | 'reasoning' | 'tool' | 'tool-result' | 'error' | 'status';
    readonly seq: number;
    /** Text shown in the compact transcript (tool rows carry their arguments). */
    readonly text: string;
    /** Tool name or tool call id, when the row is a tool row. */
    readonly name?: string;
    /** Tool result failed. */
    readonly failed?: boolean;
    readonly streaming?: boolean;
    readonly quote?: string;
    readonly turn?: number;
    readonly step?: number;
}
/**
 * Project a side session's log into compact transcript rows. Only the events
 * the side chat itself produced are rendered: the inherited fork prefix is
 * parent context, not side conversation, so it is excluded by
 * \`inheritedEventCount\`.
 * @param session - the side session.
 * @param limit - keep at most this many trailing rows.
 * @returns rendered rows, oldest first.
 */
export declare function sideChatTranscript(session: Session, limit?: number): SideChatNode[];
export declare function apply(ctx: Context, config?: Config): void;
