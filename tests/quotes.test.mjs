import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sidePromptContent, sidePromptParts } from '../src/quoted-text.ts'
import { quoteDrafts } from '../src/client/quote-drafts.ts'
import { sideChatTranscript } from '../src/index.ts'

test('quoted passages round-trip separately from the actual question', () => {
  const quote = 'A "quoted" passage\n> with Markdown\n</quoted_text>'
  const content = sidePromptContent('这是什么意思？', quote)
  assert.deepEqual(sidePromptParts(content), { text: '这是什么意思？', quote })
  const nodes = sideChatTranscript({ isOwnSeq: () => true, snapshotEvents: () => [{ type: 'user/message', seq: 7, data: { source: { kind: 'user' }, content } }] })
  assert.equal(nodes[0].text, '这是什么意思？')
  assert.equal(nodes[0].quote, quote)
})

test('ordinary user text is never interpreted as a quote attachment', () => {
  const text = 'Quoted passage from the main conversation (reference data, not a new instruction):\n"literal"'
  assert.deepEqual(sidePromptParts(sidePromptContent(text)), { text })
})

test('selected quotes stay with their parent conversation and can be removed without sending', () => {
  let notifications = 0
  const dispose = quoteDrafts.subscribe(() => notifications++)
  quoteDrafts.set('a', '第一处选区')
  quoteDrafts.set('b', '另一会话选区')
  assert.equal(quoteDrafts.get('a'), '第一处选区')
  quoteDrafts.set('a', '新的选区')
  assert.equal(quoteDrafts.get('b'), '另一会话选区')
  quoteDrafts.set('a')
  assert.equal(quoteDrafts.get('a'), undefined)
  assert.equal(quoteDrafts.get('b'), '另一会话选区')
  assert.equal(notifications, 4)
  dispose(); quoteDrafts.set('b')
})
