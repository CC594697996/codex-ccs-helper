'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { spawn, spawnSync } = require('node:child_process');
const TOML = require('@iarna/toml');
const initSqlJs = require('sql.js');
const { buildLaunch, launch } = require('../src/launcher');
const { getProviders, getCommonConfig } = require('../src/db');
const { parseArgs, fuzzyMatch, interactiveSelect } = require('../src/cli');
const fixture = (label = 'a') => ({
  auth: { OPENAI_API_KEY: `dummy-secret-${label}` },
  config: `model = 'model-${label}'\nmodel_provider = 'vendor.with.dot'\n[model_providers.'vendor.with.dot']\nbase_url = 'https://${label}.example/v1'\nwire_api = 'responses'\nrequires_openai_auth = true\n`,
});
function overrides(spec) {
  let config = {};
  for (let i = 0; i < spec.args.length && spec.args[i] === '-c'; i += 2) Object.assign(config, TOML.parse(spec.args[i + 1]));
  return config;
}
function provider(spec) { const config = overrides(spec); return config.model_providers[config.model_provider]; }

test('independent A/B launch snapshots pin endpoint/model/credential without mutating inputs or parent environment', () => {
  const a = fixture('a'); const original = JSON.stringify(a); const env = { PATH: '/bin', OPENAI_API_KEY: 'unrelated-key' };
  const first = buildLaunch(a, '', false, [], env);
  const second = buildLaunch(fixture('b'), '', false, [], env);
  a.auth.OPENAI_API_KEY = 'changed'; a.config = fixture('c').config;
  assert.equal(overrides(first).model, 'model-a'); assert.equal(provider(first).base_url, 'https://a.example/v1');
  assert.equal(overrides(second).model, 'model-b'); assert.equal(provider(second).base_url, 'https://b.example/v1');
  assert.equal(first.env.CCS_CODEX_SESSION_API_KEY, 'dummy-secret-a');
  assert.equal(second.env.CCS_CODEX_SESSION_API_KEY, 'dummy-secret-b');
  assert.equal(env.CCS_CODEX_SESSION_API_KEY, undefined);
  assert.equal(provider(first).requires_openai_auth, false);
  assert.notEqual(overrides(first).model_provider, overrides(second).model_provider);
  assert.equal(JSON.stringify(fixture('a')), original);
  assert(!JSON.stringify(first.args).includes('dummy-secret'));
  assert(!first.args.some(s => /dangerously|sandbox|approval/.test(s)));
});

test('legacy explicitly enabled common TOML overrides model, disabled common does not', () => {
  const input = fixture(); const original = JSON.stringify(input);
  assert.equal(overrides(buildLaunch(input, "model = 'common'", true)).model, 'common');
  assert.equal(overrides(buildLaunch(input, "model = 'common'", false)).model, 'model-a');
  assert.equal(JSON.stringify(input), original);
});

test('TOML handles multiline strings, comments, quoted table keys and escapes', () => {
  const input = fixture(); input.config = input.config.replace("'model-a'", '"""model-with-quote\\""""');
  assert.equal(overrides(buildLaunch(input)).model, 'model-with-quote"');
});

test('static headers are child environment only', () => {
  const input = fixture(); input.config += "[model_providers.'vendor.with.dot'.http_headers]\n'X-Secret' = 'header-secret'\n";
  const spec = buildLaunch(input); assert(!JSON.stringify(spec.args).includes('header-secret'));
  assert.equal(spec.env[provider(spec).env_http_headers['X-Secret']], 'header-secret');
});

test('unsupported or malformed settings fail without echoing secret-bearing source', () => {
  const inputs = [
    { ...fixture(), config: 'bad = "dummy-secret' },
    { ...fixture(), auth: { tokens: {} } },
    { ...fixture(), config: fixture().config.replace('responses', 'chat') },
    { ...fixture(), config: fixture().config.replace('https://a.example/v1', 'https://name:dummy-secret@a.example/v1') },
    { ...fixture(), config: fixture().config.replace('https://a.example/v1', 'https://a.example/v1/chat/completions') },
    { ...fixture(), config: fixture().config + "experimental_bearer_token = 'dummy-secret'\n" },
  ];
  for (const input of inputs) assert.throws(() => buildLaunch(input), err => !err.message.includes('dummy-secret'));
});

test('routing override arguments are rejected; ordinary arguments remain separate shell-free values', () => {
  for (const arg of ['-c', '-cmodel="x"', '--config=model="x"', '-m', '--model=x', '--profile', '--oss', '--local-provider']) {
    assert.throws(() => buildLaunch(fixture(), '', false, [arg]));
  }
  const args = ['exec', 'say "hi" & touch /tmp/not-created; $(whoami)', '--skip-git-repo-check'];
  assert.deepEqual(buildLaunch(fixture(), '', false, args).args.slice(-3), args);
});

test('spawn receives private environment, propagates exit code and does not log credentials', async () => {
  let captured; const logs = [];
  const status = await launch('Name', fixture(), false, '', ['exec', 'hello world'], {
    log: { log: s => logs.push(s), error: s => logs.push(s) },
    spawn: (cmd, args, options) => { captured = { cmd, args, options }; const child = new EventEmitter(); queueMicrotask(() => child.emit('exit', 7, null)); return child; },
  });
  assert.equal(status, 7); assert.equal(captured.options.shell, false);
  assert.equal(captured.options.env.CCS_CODEX_SESSION_API_KEY, 'dummy-secret-a');
  assert(!JSON.stringify(logs).includes('dummy-secret'));
});

test('spawn errors are sanitized; signal termination is not a successful exit', async () => {
  const logs = [];
  for (const type of ['error', 'exit']) {
    const code = await launch('Name', fixture(), false, '', [], {
      log: { log: s => logs.push(s), error: s => logs.push(s) },
      spawn: () => { const child = new EventEmitter(); queueMicrotask(() => type === 'error' ? child.emit('error', new Error('dummy-secret-a')) : child.emit('exit', null, 'SIGINT')); return child; },
    });
    assert.equal(code, type === 'error' ? 1 : 130);
  }
  assert(!JSON.stringify(logs).includes('dummy-secret'));
});

test('parent cancellation is forwarded and listeners are cleaned up', async () => {
  const before = process.listenerCount('SIGTERM'); let killed;
  const code = await launch('Name', fixture(), false, '', [], {
    log: { log() {}, error() {} },
    spawn: () => { const child = new EventEmitter(); child.kill = signal => { killed = signal; child.killed = true; queueMicrotask(() => child.emit('exit', null, signal)); }; queueMicrotask(() => process.emit('SIGTERM')); return child; },
  });
  assert.equal(killed, 'SIGTERM'); assert.equal(code, 143); assert.equal(process.listenerCount('SIGTERM'), before);
});

test('two real mock child processes receive separate argv/env, with metacharacters intact', async () => {
  const prompt = 'hello "quoted" & | ; $(no-shell)';
  async function run(label) {
    const spec = buildLaunch(fixture(label), '', false, [prompt], {});
    const child = spawn(process.execPath, ['-e', 'process.stdout.write(JSON.stringify({args:process.argv.slice(1),key:process.env.CCS_CODEX_SESSION_API_KEY}))', '--', ...spec.args], { env: spec.env });
    let out = ''; for await (const chunk of child.stdout) out += chunk;
    return JSON.parse(out);
  }
  const [a, b] = await Promise.all([run('a'), run('b')]);
  assert.equal(a.key, 'dummy-secret-a'); assert.equal(b.key, 'dummy-secret-b');
  assert.equal(a.args.at(-1), prompt); assert.equal(b.args.at(-1), prompt);
});

test('CC-Switch database selects only Codex providers and reads common TOML without any writes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-db-test-')); const file = path.join(dir, 'fixture.db');
  try {
    const SQL = await initSqlJs(); const db = new SQL.Database();
    db.run('CREATE TABLE providers (name TEXT, settings_config TEXT, meta TEXT, is_current INTEGER, app_type TEXT, sort_index INTEGER); CREATE TABLE settings (key TEXT, value TEXT)');
    for (const [name, current, type] of [['B', 0, 'codex'], ['A', 1, 'codex'], ['Claude', 1, 'claude']]) db.run('INSERT INTO providers VALUES (?, ?, ?, ?, ?, ?)', [name, JSON.stringify(fixture(name.toLowerCase())), '{"commonConfigEnabled":true}', current, type, 0]);
    db.run('INSERT INTO settings VALUES (?, ?)', ['common_config_codex', "model_reasoning_effort = 'high'"]);
    fs.writeFileSync(file, db.export()); db.close(); const before = fs.readFileSync(file);
    const providers = await getProviders(file);
    assert.deepEqual(providers.map(p => p.name), ['A', 'B']); assert.equal(providers[0].commonConfigEnabled, true);
    assert.equal(await getCommonConfig(file), "model_reasoning_effort = 'high'");
    assert.deepEqual(fs.readFileSync(file), before);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('original list/query/separator workflow and menu cancellation', async () => {
  assert.deepEqual(parseArgs(['node', 'cxs', 'work', '--', 'exec', 'hello']).codexArgs, ['exec', 'hello']);
  assert.equal(parseArgs(['node', 'cxs', '--list']).showList, true);
  const providers = [{ name: 'Work', isCurrent: true }, { name: 'Personal' }];
  assert.equal(fuzzyMatch(providers, 'wo'), providers[0]);
  require('prompts').inject([new Error('cancel')]);
  assert.equal(await interactiveSelect(providers), null);
});

test('reject management/remote commands and malformed header tables', () => {
  for (const args of [['logout'], ['mcp', 'add'], ['--cd', 'exec', 'logout'], ['-C', 'resume', 'logout'], ['--remote=wss://example.com'], ['--remote', 'ws://example.com']]) assert.throws(() => buildLaunch(fixture(), '', false, args));
  assert.throws(() => buildLaunch({ ...fixture(), config: fixture().config + "http_headers = 'invalid'\n" }));
  assert.throws(() => parseArgs(['node', 'cxs', '--no-skip']));
});

test('common merge replaces arrays and guards prototype keys', () => {
  const { merge } = require('../src/launcher');
  assert.deepEqual(merge({ a: [1, 2] }, { a: { b: 3 } }), { a: { b: 3 } });
  assert.throws(() => merge({}, JSON.parse('{"__proto__":{"bad":true}}')));
  assert.equal({}.bad, undefined);
});

test('pending SQLite WAL is rejected instead of launching stale settings', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-wal-test-')); const file = path.join(dir, 'fixture.db');
  try {
    fs.writeFileSync(file, 'not opened'); fs.writeFileSync(`${file}-wal`, 'pending');
    await assert.rejects(getProviders(file), /WAL/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('cxs symlink supports spaced checkout paths, lists providers and forwards arguments to mock codex', { skip: process.platform === 'win32' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cxs cli test '));
  try {
    const dbDir = path.join(dir, '.cc-switch'); fs.mkdirSync(dbDir);
    const SQL = await initSqlJs(); const db = new SQL.Database();
    db.run('CREATE TABLE providers (name TEXT, settings_config TEXT, meta TEXT, is_current INTEGER, app_type TEXT, sort_index INTEGER); CREATE TABLE settings (key TEXT, value TEXT)');
    db.run('INSERT INTO providers VALUES (?, ?, ?, 1, ?, 0)', ['Work', JSON.stringify(fixture('work')), '{}', 'codex']);
    const dbFile = path.join(dbDir, 'cc-switch.db'); fs.writeFileSync(dbFile, db.export()); db.close();
    fs.writeFileSync(path.join(dir, 'codex'), `#!${process.execPath}\nprocess.stdout.write(JSON.stringify({args:process.argv.slice(2),key:process.env.CCS_CODEX_SESSION_API_KEY}));\nprocess.exitCode=9;\n`, { mode: 0o700 });
    const checkout = path.join(dir, 'checkout with spaces'); fs.mkdirSync(checkout);
    fs.cpSync(path.resolve(__dirname, '../src'), path.join(checkout, 'src'), { recursive: true });
    fs.copyFileSync(path.resolve(__dirname, '../package.json'), path.join(checkout, 'package.json'));
    fs.symlinkSync(path.resolve(__dirname, '../node_modules'), path.join(checkout, 'node_modules'), 'dir');
    fs.symlinkSync(path.join(checkout, 'src/cli.js'), path.join(dir, 'cxs'));
    const env = { PATH: `${dir}${path.delimiter}${process.env.PATH}`, HOME: dir, USERPROFILE: dir };
    const before = fs.readFileSync(dbFile);
    const listed = spawnSync('cxs', ['--list'], { env, encoding: 'utf8' });
    assert.equal(listed.status, 0, listed.stderr); assert.match(listed.stdout, /Work/);
    assert(!listed.stdout.includes('dummy-secret'));
    const help = spawnSync('cxs', ['--help'], { env, encoding: 'utf8' });
    assert.equal(help.status, 0); assert.match(help.stdout, /cxs <name>/);
    assert(!/\bccs\b/.test(help.stdout));
    const version = spawnSync('cxs', ['--version'], { env, encoding: 'utf8' });
    assert.equal(version.status, 0); assert.equal(version.stdout.trim(), `cxs ${require('../package.json').version}`);
    const invalid = spawnSync('cxs', ['--invalid'], { env, encoding: 'utf8' });
    assert.equal(invalid.status, 1); assert.match(invalid.stderr, /cxs --help/);
    assert.deepEqual(fs.readFileSync(dbFile), before);
    const child = spawn('cxs', ['work', '--', 'exec', 'hello world; & |'], { env });
    const exited = new Promise(resolve => child.on('exit', resolve));
    let out = ''; for await (const chunk of child.stdout) out += chunk;
    assert.equal(await exited, 9);
    const body = JSON.parse(out.slice(out.indexOf('{')));
    assert.equal(body.key, 'dummy-secret-work'); assert.equal(body.args.at(-1), 'hello world; & |');
    assert(!out.slice(0, out.indexOf('{')).includes('dummy-secret-work'));
    assert.equal(fs.existsSync(path.join(dir, '.codex')), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});


test('unified package exposes cxs and cxd without exposing ccs', () => {
  const expected = { cxs: 'src/cli.js', cxd: 'src/desktop-cli.js' };
  assert.deepEqual(require('../package.json').bin, expected);
  assert.deepEqual(require('../npm-shrinkwrap.json').packages[''].bin, expected);
  assert.equal(parseArgs(['node', 'cxs']).query, null);
  assert.equal(parseArgs(['node', 'cxs', 'Work']).query, 'Work');
});

test('Git source packaging prepares bundled dependencies and keeps public registry URLs', () => {
  const pkg = require('../package.json');
  const lock = require('../npm-shrinkwrap.json');
  assert.equal(pkg.scripts.prepare, 'npm run check');
  assert.equal(pkg.private, true); // Guard npm publication; Git installs remain supported.
  assert.equal(pkg.version, lock.version);
  assert.equal(pkg.version, lock.packages[''].version);
  assert.deepEqual(pkg.bundleDependencies.slice().sort(), Object.keys(pkg.dependencies).sort());
  assert.deepEqual(lock.packages[''].bundleDependencies, pkg.bundleDependencies);
  assert(!pkg.scripts.preinstall && !pkg.scripts.install && !pkg.scripts.postinstall);
  for (const entry of Object.values(lock.packages)) {
    if (entry.resolved) assert.equal(new URL(entry.resolved).origin, 'https://registry.npmjs.org');
  }
});
