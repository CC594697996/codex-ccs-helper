'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const prompts = require('prompts');
const { main, interactiveMode, parseArgs } = require('../src/cli');
const { launchCLIProvider } = require('../src/unified-launcher');
const provider = { name: 'Example', config: { auth: { OPENAI_API_KEY: 'dummy' }, config: '' }, meta: {} };

for (const mode of ['cli', 'desktop']) {
  test(`bare cxs selects mode before provider and dispatches only ${mode}`, async () => {
    const calls = [];
    const status = await main(['node', 'cxs'], {
      selectMode: async () => { calls.push('mode'); return mode; },
      getProviders: async () => { calls.push('load'); return [provider]; },
      getCommonConfig: async () => '',
      selectProvider: async values => { calls.push('provider'); assert.equal(values[0], provider); return provider; },
      launchCLI: async selected => { calls.push('cli'); assert.equal(selected, provider); return 7; },
      launchDesktop: async selected => { calls.push('desktop'); assert.equal(selected, provider); return 7; },
    });
    assert.equal(status, 7);
    assert.deepEqual(calls, ['mode', 'load', 'provider', mode]);
  });
}
test('cancellation at either menu never launches a process', async () => {
  assert.equal(await main(['node', 'cxs'], { selectMode: async () => null,
    getProviders: () => { throw new Error('must not read database'); } }), 0);
  assert.equal(await main(['node', 'cxs'], { selectMode: async () => 'desktop',
    getProviders: async () => [provider], getCommonConfig: async () => '', selectProvider: async () => null,
    launchDesktop: () => { throw new Error('must not launch'); } }), 0);
});
test('mode menu accepts both choices and rejects conflicting explicit flags', async () => {
  prompts.inject(['cli', 'desktop', new Error('cancel')]);
  assert.equal(await interactiveMode(), 'cli');
  assert.equal(await interactiveMode(), 'desktop');
  assert.equal(await interactiveMode(), null);
  assert.throws(() => parseArgs(['node', 'cxs', '--cli', '--desktop']));
  assert.throws(() => parseArgs(['node', 'cxs', '--desktop', '--', 'resume']));
});
test('subscription CLI reuses selected account preparation and excludes inherited API credentials', async () => {
  let captured, preparation;
  const status = await launchCLIProvider({ ...provider, config: { auth: {} } }, '', ['resume'], {
    env: { PATH: '/bin', OPENAI_API_KEY: 'wrong-account', CODEX_ACCESS_TOKEN: 'wrong-token' },
    prepareProfile: (selected, common, options) => { preparation = options;
      return { backendHome: '/private/example', cli: '/bundled/codex' }; },
    log: { log() {}, error() {} },
    spawn: (command, args, options) => {
      captured = { command, args, options };const child = new EventEmitter();
      queueMicrotask(() => child.emit('exit', 0, null));return child;
    },
  });
  assert.equal(status, 0);
  assert.match(preparation.root, /Codex Unified Helper\/cli$/);
  assert.equal(captured.command, '/bundled/codex');
  assert.deepEqual(captured.args, ['resume']);
  assert.equal(captured.options.env.CODEX_HOME, '/private/example');
  assert.equal(captured.options.env.OPENAI_API_KEY, undefined);
  assert.equal(captured.options.env.CODEX_ACCESS_TOKEN, undefined);
});
