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
import { randomUUID } from 'node:crypto';
import z from '@deepseek-ai/schemastery';
import { buildForkSeed } from '@deepseek-ai/dsh-session/fork';
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm';
import { ROUTE_PREFIX, SIDE_ALIAS, SIDE_COMMAND } from "./invariant.js";
import { sidePromptContent, sidePromptParts } from "./quoted-text.js";
export { ROUTE_PREFIX, SIDE_ALIAS, SIDE_COMMAND, PLUGIN_ID } from "./invariant.js";
/** Plugin identity for cordis.yml rows. */
export const name = 'dsh-side-ask';
/** Services required before mounting. */
export const inject = ['webServer', 'sessions', 'agents', 'commands', 'agentPresets', 'systemPrompt'];
export const Config = z.object({
    description: z.string().default('打开一个继承当前对话上下文的临时侧边对话（不打断主任务）'),
});
/** Structured failure for the /side-chat routes. */
class SideChatError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
        this.name = 'SideChatError';
    }
}
/** Read and decode a JSON request body (bounded). */
function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > 64 * 1024) {
                reject(new SideChatError(413, 'request body too large'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            if (chunks.length === 0) {
                resolve(undefined);
                return;
            }
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
            }
            catch {
                reject(new SideChatError(400, 'request body is not valid JSON'));
            }
        });
        req.on('error', reject);
    });
}
/** Write a JSON response. */
function writeJson(res, status, payload) {
    const text = JSON.stringify(payload);
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
    });
    res.end(text);
}
/**
 * Replicate the host's fork composition: resolve the session's recorded
 * preset and mount it on the child agent, so the seeded history runs under
 * the same tools/persona that produced it. Mirrors `composeAgent` in the
 * host api-proxy (without the web model-selection store wiring, which this
 * plugin does not need).
 */
async function composeAgentFor(ctx, presetId) {
    const presets = ctx.get('agentPresets');
    if (presets === undefined) {
        return { setup: async () => { } };
    }
    const resolvedId = (await presets.resolve(presetId)).id;
    return {
        agentPreset: resolvedId,
        setup: async (agentCtx) => {
            await presets.mount(agentCtx, resolvedId);
        },
    };
}
/**
 * The balanced completed-turn prefix of a session's log, extended through
 * trailing out-of-band appends up to the next turn/start — the same seed the
 * host's `session.fork` computes, so a side chat inherits exactly the context
 * a fork would.
 */
export function sideChatSeed(parent) {
    const events = parent.snapshotEvents();
    const boundary = events.findLast(e => e.type === 'turn/end' || e.type === 'step/end'
        || (e.type === 'user/message' && e.data.source.kind === 'user'));
    if (boundary === undefined)
        return undefined;
    return events.filter(e => e.seq <= boundary.seq);
}
/** Preserve accepted history while keeping the parent's pending work out of the child. */
export function sideChatForkSeed(source, modelSelection) {
    const boundary = source.at(-1)?.seq;
    if (boundary === undefined)
        throw new SideChatError(409, 'empty fork seed');
    const seed = buildForkSeed(source, boundary);
    const pending = { 'next-turn': [], 'next-step': [] };
    for (const event of source) {
        if (event.type !== 'agent/inbox/spliced')
            continue;
        const { target, start, removedCount, inserted } = event.data;
        pending[target].splice(start, removedCount ?? 0, ...inserted);
    }
    for (const target of ['next-step', 'next-turn']) {
        if (pending[target].length === 0)
            continue;
        const last = seed.at(-1);
        seed.push({ type: 'agent/inbox/spliced', seq: (last.seq + 1), time: last.time,
            data: { target, start: 0, removedCount: pending[target].length, inserted: [], outcome: 'canceled' } });
    }
    if (modelSelection !== undefined) {
        const last = seed.at(-1);
        // The native picker reads the durable projection, including before any
        // new request/header exists. Keep it aligned with the creation options.
        // This event schema is registered by the host's api-session-controller;
        // that client/host composition package is not bundled into this plugin.
        seed.push({ type: 'model/selection', seq: last.seq + 1, time: last.time,
            data: { ...modelSelection } });
    }
    return seed;
}
/**
 * The child's agent options inherited from the parent's last logged model
 * selection, so the side chat runs on the same model the parent is using.
 */
function inheritedAgentOptions(parent, ctx) {
    // A model picked while the parent is idle has not reached request/header
    // yet. Read DSH's native pending selection before falling back to history.
    const projections = ctx.get('sessionProjections');
    const pending = projections?.stateOf(parent, 'modelSelection')?.pending;
    if (pending !== undefined && pending !== null)
        return { ...pending };
    const config = parent.requestHeader()?.config;
    if (config === undefined)
        return undefined;
    return { provider: config.provider, model: config.model,
        ...(config.reasoningEffort === undefined ? {} : { reasoningEffort: config.reasoningEffort }) };
}
/** Maximum length of a derived side-chat title (approximate, CJK-aware). */
export const SIDE_CHAT_TITLE_MAX = 24;
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
export function sideChatTitleOf(session) {
    const boundary = session.inheritedEventCount;
    const first = session.snapshotEvents().find((event) => event.type === 'user/message'
        && event.data.source.kind === 'user'
        && event.seq >= boundary);
    if (first === undefined)
        return undefined;
    const text = sidePromptParts(first.data.content).text
        .replace(/\s+/gu, ' ')
        .trim();
    if (text.length === 0)
        return undefined;
    if (text.length <= SIDE_CHAT_TITLE_MAX)
        return text;
    return `${text.slice(0, SIDE_CHAT_TITLE_MAX)}…`;
}
/** Join the text blocks of one model-facing content array. */
function textOfBlocks(content, kind = 'text') {
    if (content === undefined)
        return '';
    const parts = [];
    for (const block of content) {
        if (typeof block !== 'object' || block === null)
            continue;
        const record = block;
        if (record.type === kind && typeof record.text === 'string')
            parts.push(record.text);
    }
    return parts.join('\n').trim();
}
/** Bound one tool row's argument/result preview. */
const TOOL_PREVIEW_MAX = 400;
/**
 * Project a side session's log into compact transcript rows. Only the events
 * the side chat itself produced are rendered: the inherited fork prefix is
 * parent context, not side conversation, so it is excluded by
 * \`inheritedEventCount\`.
 * @param session - the side session.
 * @param limit - keep at most this many trailing rows.
 * @returns rendered rows, oldest first.
 */
export function sideChatTranscript(session, limit = 200) {
    const nodes = [];
    for (const event of session.snapshotEvents()) {
        if (!session.isOwnSeq(event.seq))
            continue;
        if (event.type === 'user/message') {
            if (event.data.source.kind !== 'user')
                continue;
            const parts = sidePromptParts(event.data.content);
            if (parts.text !== '' || parts.quote !== undefined)
                nodes.push({ kind: 'user', seq: event.seq, ...parts });
            continue;
        }
        if (event.type === 'assistant/message') {
            const reasoning = textOfBlocks(event.data.message.content, 'reasoning');
            if (reasoning !== '')
                nodes.push({ kind: 'reasoning', seq: event.seq, text: reasoning, turn: event.data.turn, step: event.data.step });
            const text = textOfBlocks(event.data.message.content);
            if (text !== '')
                nodes.push({ kind: 'assistant', seq: event.seq, text });
            continue;
        }
        if (event.type === 'tool/call') {
            nodes.push({
                kind: 'tool',
                seq: event.seq,
                name: event.data.name,
                text: event.data.arguments.slice(0, TOOL_PREVIEW_MAX),
            });
            continue;
        }
        if (event.type === 'tool/result') {
            nodes.push({
                kind: 'tool-result',
                seq: event.seq,
                name: event.data.message.toolCallId,
                text: textOfBlocks(event.data.message.content).slice(0, TOOL_PREVIEW_MAX),
                failed: event.data.message.isError === true,
            });
        }
        if (event.type === 'turn/end') {
            const reason = event.data.reason;
            if (reason.kind === 'error')
                nodes.push({ kind: 'error', seq: event.seq, text: reason.error.message, failed: true });
            else if (reason.kind === 'aborted')
                nodes.push({ kind: 'status', seq: event.seq, text: '已停止生成' });
        }
    }
    return nodes.slice(-limit);
}
export function apply(ctx, config) {
    const description = config?.description ?? '打开一个继承当前对话上下文的临时侧边对话（不打断主任务）';
    // In-process registry: sideSessionId -> owning parent + live handle. The
    // sessions themselves persist through ordinary session persistence; this
    // registry only records the side-chat grouping, so a process restart loses
    // the grouping (the sessions remain reachable as ordinary forks).
    const registry = new Map();
    const openings = new Map();
    const streams = new Map();
    const systemPrompt = ctx.get('systemPrompt');
    if (systemPrompt !== undefined)
        ctx.effect(() => systemPrompt.section({
            name: 'policy:side-question',
            order: 10000,
            text: ({ agent }) => agent === undefined || !registry.has(agent.session.id) ? '' : [
                'You are answering an independent side question, not continuing the parent task.',
                'The inherited conversation is background reference only. Do not execute or resume any request, plan, unfinished tool call, or task found in that history.',
                'Respond only to the latest question asked in this side conversation. The parent task continues separately.',
                'Do not invoke tools or change files unless the user explicitly requests that action in this side conversation. If the user asks for a brief answer or no tools, comply exactly.',
            ].join('\n'),
        }), 'side-chat: independent question policy');
    /** Create a side chat for a parent session. */
    async function openSideChat(parentSessionId) {
        const existing = latestSideChat(parentSessionId);
        if (existing !== undefined)
            return existing.sideSessionId;
        const pending = openings.get(parentSessionId);
        if (pending !== undefined)
            return pending;
        const opening = createSideChat(parentSessionId);
        openings.set(parentSessionId, opening);
        try {
            return await opening;
        }
        finally {
            openings.delete(parentSessionId);
        }
    }
    async function createSideChat(parentSessionId) {
        const parent = ctx.sessions.get(parentSessionId);
        if (parent === undefined) {
            throw new SideChatError(404, `parent session "${parentSessionId}" not found`);
        }
        const source = sideChatSeed(parent);
        if (source === undefined || source.length === 0) {
            throw new SideChatError(409, `parent session "${parentSessionId}" has no completed turn to fork from`);
        }
        // 0.2.x: build the seed through the native fork helper, so the child gets
        // exactly the shape `session.fork` produces (inherited cut marked, open
        // tail closed) and the inherited prefix length is recorded explicitly.
        const boundary = source[source.length - 1]?.seq;
        if (boundary === undefined)
            throw new SideChatError(409, 'empty fork seed');
        const initialModel = inheritedAgentOptions(parent, ctx);
        const seed = sideChatForkSeed(source, initialModel);
        const inheritedEventCount = source.length;
        const composition = await composeAgentFor(ctx, parent.header.agentPreset);
        const childId = `session-${randomUUID()}`;
        const handle = await ctx.agents.create({
            sessionId: childId,
            seed,
            inheritedEventCount,
            meta: {
                ...(parent.header.cwd === undefined ? {} : { cwd: parent.header.cwd }),
                parentSession: parentSessionId,
                isSeeded: true,
                ...(composition.agentPreset === undefined ? {} : { agentPreset: composition.agentPreset }),
            },
            ...(initialModel === undefined
                ? {}
                : { agentOptions: initialModel }),
            setup: composition.setup,
        });
        registry.set(childId, {
            parentSessionId,
            createdAt: Date.now(),
            handle,
        });
        return childId;
    }
    /** List side chats of one parent, newest first. */
    function listSideChats(parentSessionId) {
        const rows = [];
        for (const [sideSessionId, record] of registry) {
            if (parentSessionId !== undefined && record.parentSessionId !== parentSessionId)
                continue;
            const agent = ctx.agents.get(sideSessionId);
            const side = ctx.sessions.get(sideSessionId);
            rows.push({
                sideSessionId,
                parentSessionId: record.parentSessionId,
                createdAt: record.createdAt,
                running: agent?.status === 'running',
                title: side === undefined ? '' : (sideChatTitleOf(side) ?? ''),
            });
        }
        return rows.sort((a, b) => b.createdAt - a.createdAt);
    }
    /** Live agent of a registered side chat. */
    function sideAgentOf(sideSessionId) {
        if (!registry.has(sideSessionId))
            throw new SideChatError(404, 'side chat not found');
        const agent = ctx.agents.get(sideSessionId);
        if (agent === undefined)
            throw new SideChatError(404, `side chat "${sideSessionId}" is not live`);
        return agent;
    }
    /** Whether the parent conversation is mid-turn. */
    function parentRunning(parentSessionId) {
        return ctx.agents.get(parentSessionId)?.status === 'running';
    }
    /**
     * Send one user message into a live side agent. This is the same inbox path
     * the GUI's composer uses, so the side turn streams exactly like a normal
     * conversation; the message is owned by this plugin's producer kind.
     */
    async function promptSideChat(sideSessionId, text, quote) {
        const agent = sideAgentOf(sideSessionId);
        const message = createUserMessage({
            content: sidePromptContent(text, quote),
            source: { kind: 'user' },
        });
        agent.followup(message);
    }
    /**
     * Newest side chat in the registry (pane bootstrap).
     * @param parentSessionId - restrict to side chats forked from this session.
     */
    function latestSideChat(parentSessionId) {
        let newest;
        for (const row of listSideChats(parentSessionId)) {
            if (newest === undefined || row.createdAt > newest.createdAt)
                newest = row;
        }
        return newest;
    }
    /**
     * Close a side chat: dispose the agent (removes the live session → the GUI
     * drops it via `host/session-removed`) and archive the session so it stays
     * hidden from the workspace tree even though the persisted log remains
     * (DSH has no persisted-log delete; archiving is the native "removed from
     * view" operation the workspace browser honors).
     */
    async function closeSideChat(sideSessionId) {
        const record = registry.get(sideSessionId);
        if (record === undefined) {
            return;
        }
        registry.delete(sideSessionId);
        streams.delete(sideSessionId);
        const handle = record.handle;
        try {
            await handle.dispose();
        }
        finally {
            // Best-effort: without the workspace service composed, the live
            // dispose above still removes the session from the GUI.
            const workspaces = ctx.get('workspaceRegistry');
            if (workspaces !== undefined) {
                await workspaces.archiveSession(sideSessionId).catch((error) => {
                    ctx.logger.warn(`[dsh-side-ask] archive "${sideSessionId}" failed: ${String(error)}`);
                });
            }
        }
    }
    ctx.effect(() => ctx.on('agent/assistant-stream', ({ agent, frame }) => {
        if (!registry.has(agent.session.id))
            return;
        if (frame.type === 'start')
            streams.set(agent.session.id, { attemptId: frame.attemptId, assembler: new BlockAssembler(), turn: frame.turn, step: frame.step });
        else if (frame.type === 'end')
            streams.delete(agent.session.id);
        else {
            const stream = streams.get(agent.session.id);
            if (stream?.attemptId === frame.attemptId)
                stream.assembler.push(frame.chunk);
        }
    }), 'side-chat: live output');
    ctx.effect(() => ctx.on('agent/error', ({ agent, error }) => {
        if (!registry.has(agent.session.id))
            return;
        console.error('[side-chat] agent failed:', error instanceof Error ? error.stack : String(error));
    }), 'side-chat: error diagnostics');
    // Profile reloads must release ephemeral agents as well as their routes.
    ctx.effect(() => () => {
        for (const id of registry.keys())
            void closeSideChat(id);
    }, 'side-chat: plugin cleanup');
    /**
     * Orphan cleanup: when a session is disposed, dispose every side chat
     * (transitively) that descends from it. A parent conversation closed or
     * removed must not leave running side agents behind.
     */
    ctx.effect(() => {
        return ctx.on('session/disposed', (session) => {
            void (async () => {
                const doomed = [];
                const seen = new Set([session.id]);
                // Cascade through the registry: a side chat may itself be a parent.
                for (let changed = true; changed;) {
                    changed = false;
                    for (const [id, record] of registry) {
                        if (!seen.has(record.parentSessionId) || seen.has(id))
                            continue;
                        seen.add(id);
                        doomed.push(id);
                        changed = true;
                    }
                }
                for (const id of doomed) {
                    const record = registry.get(id);
                    registry.delete(id);
                    streams.delete(id);
                    if (record === undefined)
                        continue;
                    try {
                        await record.handle.dispose();
                    }
                    catch (error) {
                        ctx.logger.warn(`[dsh-side-ask] orphan cleanup of "${id}" failed: ${String(error)}`);
                    }
                }
            })();
        });
    }, 'dsh-side-ask: orphan cleanup');
    // ── /side-chat routes ──────────────────────────────────────────────────
    ctx.effect(() => {
        const dispose = ctx.webServer.register({
            kind: 'prefix',
            path: ROUTE_PREFIX,
            handler: async (req, res) => {
                try {
                    const url = new URL(req.url ?? '/', 'http://localhost');
                    const path = url.pathname.replace(/\/+$/, '') || '/side-chat';
                    if (req.method === 'POST' && path === `${ROUTE_PREFIX}/open`) {
                        const body = (await readJsonBody(req));
                        const parentSessionId = body?.parentSessionId;
                        if (typeof parentSessionId !== 'string') {
                            throw new SideChatError(400, 'missing string field: parentSessionId');
                        }
                        const sideSessionId = await openSideChat(parentSessionId);
                        writeJson(res, 200, { sideSessionId });
                        return;
                    }
                    if (req.method === 'GET' && path === `${ROUTE_PREFIX}/list`) {
                        const parentSessionId = url.searchParams.get('parentSessionId');
                        if (parentSessionId === null) {
                            throw new SideChatError(400, 'missing query param: parentSessionId');
                        }
                        writeJson(res, 200, { sideChats: listSideChats(parentSessionId) });
                        return;
                    }
                    if (req.method === 'POST' && path === `${ROUTE_PREFIX}/close`) {
                        const body = (await readJsonBody(req));
                        const sideSessionId = body?.sideSessionId;
                        if (typeof sideSessionId !== 'string') {
                            throw new SideChatError(400, 'missing string field: sideSessionId');
                        }
                        await closeSideChat(sideSessionId);
                        writeJson(res, 200, { ok: true });
                        return;
                    }
                    if (req.method === 'POST' && path === `${ROUTE_PREFIX}/close-parent`) {
                        const body = (await readJsonBody(req));
                        if (typeof body?.parentSessionId !== 'string')
                            throw new SideChatError(400, 'missing string field: parentSessionId');
                        const parent = body.parentSessionId;
                        await openings.get(parent)?.catch(() => undefined);
                        for (const row of listSideChats(parent))
                            await closeSideChat(row.sideSessionId);
                        writeJson(res, 200, { ok: true });
                        return;
                    }
                    if (req.method === 'POST' && path === `${ROUTE_PREFIX}/prompt`) {
                        const body = (await readJsonBody(req));
                        const sideSessionId = body?.sideSessionId;
                        const text = body?.text;
                        if (typeof sideSessionId !== 'string') {
                            throw new SideChatError(400, 'missing string field: sideSessionId');
                        }
                        if (typeof text !== 'string' || text.trim() === '') {
                            throw new SideChatError(400, 'missing non-empty string field: text');
                        }
                        if (body.quote !== undefined && typeof body.quote !== 'string')
                            throw new SideChatError(400, 'quote must be a string');
                        await promptSideChat(sideSessionId, text, body.quote);
                        writeJson(res, 200, { ok: true });
                        return;
                    }
                    if (req.method === 'POST' && path === `${ROUTE_PREFIX}/stop`) {
                        const body = (await readJsonBody(req));
                        if (typeof body?.sideSessionId !== 'string')
                            throw new SideChatError(400, 'missing string field: sideSessionId');
                        sideAgentOf(body.sideSessionId).cancel({ kind: 'user' });
                        writeJson(res, 200, { ok: true });
                        return;
                    }
                    if (req.method === 'GET' && path === `${ROUTE_PREFIX}/transcript`) {
                        const sideSessionId = url.searchParams.get('sideSessionId');
                        if (sideSessionId === null) {
                            throw new SideChatError(400, 'missing query param: sideSessionId');
                        }
                        const side = ctx.sessions.get(sideSessionId);
                        if (side === undefined) {
                            throw new SideChatError(404, `side chat "${sideSessionId}" is not live`);
                        }
                        const record = registry.get(sideSessionId);
                        if (record === undefined)
                            throw new SideChatError(404, 'side chat not found');
                        const parentSessionId = record?.parentSessionId;
                        const agent = ctx.agents.get(sideSessionId);
                        const nodes = sideChatTranscript(side);
                        const stream = streams.get(sideSessionId);
                        const blocks = stream?.assembler.interruptedBlocks();
                        const liveText = textOfBlocks(blocks);
                        const liveReasoning = textOfBlocks(blocks, 'reasoning');
                        if (stream !== undefined && (liveReasoning !== '' || liveText === ''))
                            nodes.push({ kind: 'reasoning', seq: -2, text: liveReasoning, streaming: liveText === '', turn: stream.turn, step: stream.step });
                        if (liveText !== '')
                            nodes.push({ kind: 'assistant', seq: -1, text: liveText, streaming: true });
                        writeJson(res, 200, {
                            sideSessionId,
                            parentSessionId: parentSessionId ?? null,
                            title: sideChatTitleOf(side) ?? '',
                            running: agent?.status === 'running',
                            parentRunning: parentSessionId === undefined ? false : parentRunning(parentSessionId),
                            nodes,
                        });
                        return;
                    }
                    if (req.method === 'GET' && path === `${ROUTE_PREFIX}/latest`) {
                        const parent = url.searchParams.get('parentSessionId');
                        writeJson(res, 200, { sideChat: latestSideChat(parent === null ? undefined : parent) ?? null });
                        return;
                    }
                    writeJson(res, 404, { error: 'not-found' });
                }
                catch (error) {
                    if (error instanceof SideChatError) {
                        writeJson(res, error.status, { error: error.message });
                        return;
                    }
                    const message = error instanceof Error ? error.message : String(error);
                    ctx.logger.warn(`[dsh-side-ask] route error: ${message}`);
                    writeJson(res, 500, { error: message });
                }
            },
        });
        return dispose;
    }, 'dsh-side-ask: /side-chat routes');
    // ── /side human command ────────────────────────────────────────────────
    ctx.effect(() => {
        const disposers = [SIDE_COMMAND, SIDE_ALIAS].map(commandName => ctx.commands.register({
            name: commandName,
            description: commandName === SIDE_COMMAND
                ? description
                : `${description}（/side 的别名）`,
            recordInput: false,
            handler: async (invocation) => {
                const parentSessionId = invocation.agent.session.id;
                const sideSessionId = await openSideChat(parentSessionId);
                // Accept a one-shot question on the command line: `/side <text>`.
                const inline = invocation.rawInput.trim();
                if (inline === '') {
                    return { kind: 'success', text: `已打开侧边对话（${sideSessionId}），可在侧边面板中继续提问。` };
                }
                await promptSideChat(sideSessionId, inline);
                return { kind: 'success', text: `已在侧边对话中提问：${inline}` };
            },
        }));
        return () => { for (const dispose of disposers)
            dispose(); };
    }, 'dsh-side-ask: /side command');
}
