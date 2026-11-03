import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { sideChatSeed, sideChatTranscript, sideChatForkSeed, apply } from '../src/index.ts'

const event = (seq, type, data = {}) => ({ seq, type, time: 1000 + seq, data })
const session = (events, inherited = 0) => ({
  snapshotEvents: () => events,
  isOwnSeq: seq => seq >= inherited,
  inheritedEventCount: inherited,
})

test('a fork excludes a parent pending inbox after its completed boundary', () => {
  const events = [event(0, 'turn/start'), event(1, 'turn/end'), event(2, 'agent/inbox/spliced', { inserted: ['parent-only'] })]
  assert.deepEqual(sideChatSeed(session(events)), events.slice(0, 2))
})

test('a side question can start while the parent is in its first turn', () => {
  const events = [event(0, 'turn/start'), event(1, 'user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'main task' }] }), event(2, 'agent/inbox/spliced')]
  assert.deepEqual(sideChatSeed(session(events)), events.slice(0, 2))
})

test('a side question includes the current main question and completed step, excluding queued input', () => {
  const events = [event(0, 'turn/end'), event(1, 'turn/start'), event(2, 'user/message', { source: { kind: 'user' } }), event(3, 'step/end'), event(4, 'agent/inbox/spliced')]
  assert.deepEqual(sideChatSeed(session(events)), events.slice(0, 4))
})

test('a queued parent message inside the inherited prefix is cancelled in the child before startup', () => {
  const source = [event(0, 'turn/start', { turn: 1 }), event(1, 'user/message', { source: { kind: 'user' }, content: [] }), event(2, 'agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [{ content: [{ type: 'text', text: 'parent-only pending work' }] }] }), event(3, 'step/end', { turn: 1, step: 1 })]
  const seed = sideChatForkSeed(source)
  const queue = []
  for (const e of seed) if (e.type === 'agent/inbox/spliced' && e.data.target === 'next-turn') queue.splice(e.data.start, e.data.removedCount ?? 0, ...e.data.inserted)
  assert.equal(queue.length, 0)
  assert.equal(source.length, 4)
  assert.equal(source[2].data.inserted.length, 1)
})

test('the child picker sees the inherited current model before its first prompt', () => {
  const source = [event(0, 'turn/start', { turn: 1 }), event(1, 'turn/end', { turn: 1 })]
  const current = { provider: 'deepseek', model: 'new-model', reasoningEffort: 'high' }
  const seed = sideChatForkSeed(source, current)
  assert.equal(seed.at(-1).type, 'model/selection')
  assert.deepEqual(seed.at(-1).data, current)
  assert.equal(source.length, 2)
})

test('assistant reasoning remains separate from its answer and excludes parent reasoning', () => {
  const events = [
    event(0, 'assistant/message', { message: { content: [{ type: 'reasoning', text: 'parent reasoning' }] } }),
    event(1, 'assistant/message', { message: { content: [{ type: 'reasoning', text: 'side reasoning' }, { type: 'text', text: 'side answer' }] } }),
  ]
  assert.deepEqual(sideChatTranscript(session(events, 1)).map(n => [n.kind, n.text]), [['reasoning', 'side reasoning'], ['assistant', 'side answer']])
})

test('transcript hides inherited messages and reports a failed side turn', () => {
  const events = [
    event(0, 'user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'parent secret' }] }),
    event(1, 'user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'side only' }] }),
    event(2, 'turn/end', { reason: { kind: 'error', error: { message: 'provider unavailable', code: 'FAILED' } } }),
  ]
  const nodes = sideChatTranscript(session(events, 1))
  assert.equal(nodes[0].text, 'side only')
  assert.equal(nodes.length, 2)
  assert.equal(nodes[1].kind, 'error')
  assert.match(nodes[1].text, /provider unavailable/)
  assert.ok(!JSON.stringify(nodes).includes('parent secret'))
})

test('client module and service prerequisites agree with the package identity', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)))
  let module
  const primitives = new Proxy({}, { get: () => () => null })
  vm.runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load: definition => { module = definition } } },
  })
  assert.equal(module.id, pkg.name)
  const client = module.factory(id => id === '@deepseek-ai/dsh-client-ui-primitives' ? primitives : {})
  assert.equal(client.name, pkg.name)
  assert.ok(client.inject.includes('slots'))
  assert.ok(client.inject.includes('sidebarRightTabs'))
  assert.ok(client.inject.includes('sidebarRight'))
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-renderer'))
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-sidebar-right'))
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-api-session-controller'))
})

test('native tab registration keeps a stable pane and installs close cleanup', () => {
  let module
  vm.runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), { window: { __ModuleLoader__: { load: d => { module = d } }, setTimeout: () => 1, clearTimeout() {} } })
  const client = module.factory(() => new Proxy({}, { get: () => () => null }))
  let definition, closeKind
  const disposers = []
  client.apply({
    sidebarRightTabs: { register: d => { definition = d; return () => {} } },
    sidebarRight: { registerCloseHandler: kind => { closeKind = kind; return () => {} }, mounted: { getSnapshot: () => undefined } },
    slots: { inject: (_seat, f) => f(), register: () => () => {} },
    effect: f => { const d = f(); if (typeof d === 'function') disposers.push(d) },
    get: () => undefined,
  })
  assert.equal(definition.keepMounted, true)
  assert.equal(closeKind, definition.kind)
  for (const dispose of disposers.reverse()) dispose()
})

test('prompt and stop routes cannot target an unregistered main conversation', async () => {
  const routes = []
  const ctx = {
    sessions: { get: () => undefined }, agents: { get: () => ({ followup() { throw new Error('main was modified') } }) },
    webServer: { register: r => { routes.push(r); return () => {} } },
    effect: f => f(), on: () => () => {}, commands: { register: () => () => {} },
    get: () => undefined, logger: { warn() {} },
  }
  apply(ctx)
  const { Readable } = await import('node:stream')
  for (const path of ['prompt', 'stop']) {
    const req = Readable.from([Buffer.from(JSON.stringify({ sideSessionId: 'main-session', text: 'hello' }))])
    req.url = `/side-chat/${path}`; req.method = 'POST'
    let status
    const res = { writeHead: s => { status = s }, end() {} }
    await routes[0].handler(req, res)
    assert.equal(status, 404)
  }
})

test('side lifecycle deduplicates opens, scopes its policy, streams text and stops only the child', async () => {
  const { Readable } = await import('node:stream')
  const parentSelection = { provider: 'deepseek', model: 'flash', reasoningEffort: 'high' }
  const parent = { ...session([event(0, 'turn/start', { turn: 1 }), event(1, 'user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'parent task' }] }), event(2, 'turn/end', { turn: 1, reason: { kind: 'completed' } })]), id: 'parent', header: {}, requestHeader: () => ({ config: { ...parentSelection, model: 'previous-model' } }) }
  const sessions = new Map([['parent', parent]])
  const agents = new Map()
  const listeners = new Map()
  let route, policy, creates = 0, disposed = 0, prompt, cancelled, createOptions
  const ctx = {
    sessions: { get: id => sessions.get(id) },
    agents: {
      get: id => agents.get(id),
      async create(options) {
        createOptions = options
        creates++
        await new Promise(resolve => setImmediate(resolve))
        const child = { ...session(options.seed, options.inheritedEventCount), id: options.sessionId }
        const agent = { session: child, status: 'idle', followup: value => { prompt = value }, cancel: cause => { cancelled = [child.id, cause.kind] } }
        sessions.set(child.id, child); agents.set(child.id, agent)
        return { async dispose() { disposed++; agents.delete(child.id); sessions.delete(child.id) } }
      },
    },
    webServer: { register: r => { route = r; return () => {} } },
    effect: f => f(), on: (name, f) => { listeners.set(name, f); return () => {} },
    commands: { register: () => () => {} }, logger: { warn() {} },
    get: name => name === 'systemPrompt' ? { section: value => { policy = value; return () => {} } }
      : name === 'sessionProjections' ? { stateOf: () => ({ pending: parentSelection }) } : undefined,
  }
  apply(ctx)
  async function request(path, body) {
    const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : [])
    req.url = '/side-chat/' + path; req.method = body ? 'POST' : 'GET'
    let status, payload
    await route.handler(req, { writeHead: s => { status = s }, end: text => { payload = JSON.parse(text) } })
    assert.equal(status, 200)
    return payload
  }
  const [a, b] = await Promise.all([request('open', { parentSessionId: 'parent' }), request('open', { parentSessionId: 'parent' })])
  assert.equal(a.sideSessionId, b.sideSessionId)
  assert.equal(creates, 1)
  assert.deepEqual(createOptions.agentOptions, parentSelection)
  assert.notEqual(createOptions.agentOptions, parentSelection)
  const id = a.sideSessionId
  const childAgent = agents.get(id)
  assert.equal(policy.text({ agent: { session: parent } }), '')
  assert.match(policy.text({ agent: childAgent }), /not continuing the parent task/)
  await request('prompt', { sideSessionId: id, text: 'side only' })
  assert.deepEqual(prompt.content, [{ type: 'text', text: 'side only' }])
  assert.equal(Object.isFrozen(prompt), true)
  const emit = frame => listeners.get('agent/assistant-stream')({ agent: childAgent, frame })
  emit({ type: 'start', attemptId: 'test', revision: 1, turn: 2, step: 1 })
  emit({ type: 'chunk', attemptId: 'test', revision: 1, chunk: { type: 'reasoning-delta', index: 0, text: 'visible model reasoning' } })
  let thinking = await request('transcript?sideSessionId=' + id)
  assert.equal(thinking.nodes.at(-1).kind, 'reasoning')
  assert.equal(thinking.nodes.at(-1).text, 'visible model reasoning')
  assert.equal(thinking.nodes.at(-1).streaming, true)
  emit({ type: 'chunk', attemptId: 'test', revision: 1, chunk: { type: 'text-delta', index: 1, text: '收到' } })
  let transcript = await request('transcript?sideSessionId=' + id)
  assert.equal(transcript.nodes.at(-1).text, '收到')
  assert.equal(transcript.nodes.at(-1).streaming, true)
  emit({ type: 'end', attemptId: 'test', revision: 1 })
  transcript = await request('transcript?sideSessionId=' + id)
  assert.equal(transcript.nodes.length, 0)
  await request('stop', { sideSessionId: id })
  assert.deepEqual(cancelled, [id, 'user'])
  await request('close-parent', { parentSessionId: 'parent' })
  assert.equal(disposed, 1)
  assert.equal(sessions.get('parent'), parent)
  assert.equal((await request('list?parentSessionId=parent')).sideChats.length, 0)
})
