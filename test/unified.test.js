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

// Regression: FORCE_CLI redirects durable cloud IDs into local rollout lookup.
test('Desktop preserves native cloud routing with a private local backend', () => {
  const { desktopEnvironment } = require('../src/desktop');
  const parent = { PATH: '/bin', CODEX_APP_SERVER_FORCE_CLI: '1',
    CODEX_APP_SERVER_WS_URL: 'ws://unrelated-local-backend', ELECTRON_RUN_AS_NODE: '1',
    CODEX_HOME: '/other-home', CODEX_CLI_PATH: '/other-backend' };
  const env = desktopEnvironment({ sharedHome: '/shared', desktopDir: '/private/desktop', wrapper: '/private/wrapper' }, parent);
  assert.equal(env.CODEX_APP_SERVER_FORCE_CLI, undefined);
  assert.equal(env.CODEX_APP_SERVER_WS_URL, undefined);
  assert.equal(env.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(env.CODEX_HOME, '/shared');
  assert.equal(env.CODEX_ELECTRON_USER_DATA_PATH, '/private/desktop');
  assert.equal(env.CODEX_CLI_PATH, '/private/wrapper');
  assert.equal(env.PATH, '/bin');
  assert.equal(parent.CODEX_APP_SERVER_FORCE_CLI, '1');
});

test('Desktop wrapper execs the native process and preserves provider isolation', t => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const { spawnSync } = require('node:child_process');
  const { desktopWrapper } = require('../src/desktop');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cxs-wrapper-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const fixture = path.join(dir, 'native-fixture.js'), wrapper = path.join(dir, 'wrapper');
  fs.writeFileSync(fixture, `console.log(JSON.stringify({pid:process.pid,args:process.argv.slice(2),
    home:process.env.CODEX_HOME,cli:process.env.CODEX_CLI_PATH,key:process.env.CCS_CODEX_SESSION_API_KEY,
    inherited:process.env.OPENAI_API_KEY,codexKey:process.env.CODEX_API_KEY,
    token:process.env.CODEX_ACCESS_TOKEN,authToken:process.env.CODEX_AUTH_TOKEN}));`);
  const privateHome = path.join(dir, "account's private home");
  fs.writeFileSync(wrapper, desktopWrapper({ cli: process.execPath, backendHome: privateHome,
    env: { CCS_CODEX_SESSION_API_KEY: "dummy'$(ignored)`value" } },
    { model_provider: 'custom', cli_auth_credentials_store: 'file' }), { mode: 0o700 });
  const parentEnv = { ...process.env, OPENAI_API_KEY: 'wrong', CODEX_API_KEY: 'wrong',
    CODEX_ACCESS_TOKEN: 'wrong', CODEX_AUTH_TOKEN: 'wrong' };
  delete parentEnv.CCS_CODEX_SESSION_API_KEY;
  const run = (args, expectedKey = "dummy'$(ignored)`value") => {
    const result = spawnSync(wrapper, [fixture, ...args], { encoding: 'utf8',
      env: parentEnv });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.pid, result.pid, 'wrapper must replace itself, not parent the CLI');
    assert.equal(output.home, privateHome);
    assert.equal(output.cli, process.execPath);
    assert.equal(output.key ?? null, expectedKey);
    assert.equal(output.inherited, undefined);
    assert.equal(output.codexKey, undefined);
    assert.equal(output.token, undefined);
    assert.equal(output.authToken, undefined);
    return output.args;
  };
  assert.deepEqual(run(['app-server', '-c', 'model_provider="wrong"']),
    ['app-server', '-c', 'model_provider="wrong"', '-c', 'model_provider="custom"', '-c', 'cli_auth_credentials_store="file"']);
  assert.deepEqual(run(['exec-server', '--environment-id', 'example']), ['exec-server', '--environment-id', 'example']);
  assert.deepEqual(run(['--version']), ['--version']);
  assert.deepEqual(run(['code-mode-host', '--stdio']), ['code-mode-host', '--stdio']);
  fs.writeFileSync(wrapper, desktopWrapper({ cli: process.execPath, backendHome: privateHome, env: {} },
    { model_provider: 'openai', cli_auth_credentials_store: 'file' }));
  assert.deepEqual(run(['app-server'], null),
    ['app-server', '-c', 'model_provider="openai"', '-c', 'cli_auth_credentials_store="file"']);
});
