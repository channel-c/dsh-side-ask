import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'

test('side model integration leaves the native model slot with its original owner in either load order', () => {
  for (const sideFirst of [true, false]) {
    const slots = new SlotCore()
    slots.register({ name: 'root', children: {
      'sidebar.right.pane.tab': { kind: 'keyed', scope: 'root' },
      'native-composer': { kind: 'single', scope: 'root' },
    } }, () => null)
    const mountNative = () => slots.register({ name: 'native-composer', children: {
      'conversation.input.model': { kind: 'single', scope: 'session' },
    } }, () => null)
    if (!sideFirst) mountNative()
    let definition
    vm.runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), {
      window: { __ModuleLoader__: { load: value => { definition = value } }, setTimeout: () => 1, clearTimeout() {} },
    })
    const client = definition.factory(() => new Proxy({}, { get: () => () => null }))
    assert.doesNotThrow(() => client.apply({
      sessions: {}, locale: { bind: () => () => '' },
      sidebarRightTabs: { register: () => () => {} },
      sidebarRight: { registerCloseHandler: () => () => {}, mounted: { getSnapshot: () => undefined } },
      slots: { inject: (_key, setup) => setup(), register: slots.register.bind(slots) },
      effect: setup => setup(),
    }))
    if (sideFirst) assert.doesNotThrow(mountNative)
    assert.equal(slots.spec('conversation.input.model').scope, 'session')
  }
})
