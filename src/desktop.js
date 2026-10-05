'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const TOML = require('@iarna/toml');
const { buildLaunch, merge, parseConfig } = require('./launcher');

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function privateWrite(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data, { mode: 0o600, flag: 'wx' });
  fs.renameSync(tmp, file);
}
function desktopWrapper(manifest, config) {
  const quote = value => `'${String(value).replace(/'/g, "'\\''")}'`;
  const env = { ...manifest.env, CODEX_HOME: manifest.backendHome, CODEX_CLI_PATH: manifest.cli };
  const exports = Object.entries(env).map(([key, value]) => {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) throw new Error('桌面实例的环境变量名称无效。');
    return `export ${key}=${quote(value)}`;
  });
  const overrides = [];
  for (const key of ['model_provider', 'model_providers', 'model', 'cli_auth_credentials_store', 'sqlite_home']) {
    if (config[key] !== undefined) overrides.push('-c', `${key}=${TOML.stringify.value(config[key])}`);
  }
  // exec replaces the shell with the signed native CLI, preserving Desktop's
  // native process ancestry without a persistent system Node intermediary.
  return ['#!/bin/sh',
    'unset OPENAI_API_KEY CODEX_API_KEY CODEX_ACCESS_TOKEN CODEX_AUTH_TOKEN',
    ...exports, 'for cxs_arg in "$@"; do',
    '  if [ "$cxs_arg" = app-server ]; then',
    `    exec ${quote(manifest.cli)} "$@" ${overrides.map(quote).join(' ')}`,
    '  fi', 'done', `exec ${quote(manifest.cli)} "$@"`, ''].join('\n');
}
function jwtSubject(token) {
  try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).sub; } catch { return null; }
}
function matchingAuth(auth, account) {
  const subject = jwtSubject(account.id_token || '');
  return Boolean(subject && auth?.auth_mode === 'chatgpt' &&
    auth.tokens?.account_id === account.chatgpt_account_id &&
    jwtSubject(auth.tokens.id_token || '') === subject);
}
function selectOAuth(provider, sharedHome, backendHome, ccDir) {
  const binding = provider.meta?.authBinding;
  if (!binding?.accountId) throw new Error('请在 CC Switch 中选择绑定了具体 ChatGPT 账号的订阅配置。');
  const store = readJson(path.join(ccDir, 'codex_oauth_auth.json'));
  const account = store.accounts?.[binding.accountId];
  if (!account?.refresh_token || !account.id_token || !account.chatgpt_account_id) {
    throw new Error('所选订阅没有完整的已保存登录信息，请先在 CC Switch 中登录并选择该账号一次。');
  }
  const candidates = [];
  for (const file of [path.join(sharedHome, 'auth.json'), path.join(backendHome, 'auth.json')]) {
    if (!fs.existsSync(file)) continue;
    const auth = readJson(file);
    if (matchingAuth(auth, account)) candidates.push(auth);
  }
  candidates.sort((a, b) => Date.parse(b.last_refresh || 0) - Date.parse(a.last_refresh || 0));
  // Prefer an already-issued access token. Native Codex performs refreshes in
  // the private home; the Helper never calls OAuth or rewrites CC Switch.
  if (candidates[0] && Date.parse(candidates[0].last_refresh || 0) >= (account.token_updated_at_ms || 0)) return candidates[0];
  return { auth_mode: 'chatgpt', OPENAI_API_KEY: null,
    tokens: { id_token: account.id_token, access_token: '', refresh_token: account.refresh_token, account_id: account.chatgpt_account_id },
    last_refresh: '1970-01-01T00:00:00Z' };
}
function appPaths(appOverride) {
  const app = appOverride || ['/Applications/ChatGPT.app', '/Applications/Codex.app'].find(p => fs.existsSync(p));
  if (!app) throw new Error('找不到 Codex 桌面应用。');
  const info = spawnSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleExecutable', path.join(app, 'Contents/Info.plist')], { encoding: 'utf8' });
  if (info.status !== 0) throw new Error('无法读取 Codex 桌面应用信息。');
  const cli = [path.join(app, 'Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'), path.join(app, 'Contents/Resources/codex')].find(p => fs.existsSync(p));
  if (!cli) throw new Error('找不到桌面版内置的 Codex 后端。');
  return { app, executable: path.join(app, 'Contents/MacOS', info.stdout.trim()), cli };
}
function processOwnsInstance(pid, desktopDir) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  const result = spawnSync('/bin/ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
  return result.status === 0 && result.stdout.includes(`--user-data-dir=${desktopDir}`);
}
function prepareDesktop(provider, commonConfig = '', options = {}) {
  if (process.platform !== 'darwin') throw new Error('桌面启动功能目前仅支持 macOS。');
  const sharedHome = fs.realpathSync(options.sharedHome || process.env.CODEX_HOME || path.join(os.homedir(), '.codex'));
  const root = options.root || path.join(os.homedir(), 'Library/Application Support/Codex Desktop Helper/desktop');
  const key = crypto.createHash('sha256').update(provider.name + '\0' + (provider.meta?.authBinding?.accountId || '')).digest('hex').slice(0, 20);
  const dir = path.join(root, key), backendHome = path.join(dir, 'backend'), desktopDir = path.join(dir, 'desktop');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const pidFile = path.join(dir, 'pid.json');
  if (fs.existsSync(pidFile) && processOwnsInstance(readJson(pidFile).pid, desktopDir)) {
    throw new Error('这条配置的桌面实例已经运行。请使用已有窗口；退出该窗口后可以重新启动。');
  }
  fs.mkdirSync(backendHome, { recursive: true, mode: 0o700 });
  fs.mkdirSync(desktopDir, { recursive: true, mode: 0o700 });
  const baseFile = path.join(sharedHome, 'config.toml');
  const config = fs.existsSync(baseFile) ? parseConfig(fs.readFileSync(baseFile, 'utf8'), 'Shared config') : {};
  let tag = config.model_provider || 'openai';
  let env = {}, auth, providerConfig;
  if (provider.config.auth?.OPENAI_API_KEY) {
    const source = parseConfig(provider.config.config, 'Provider config');
    tag = source.model_provider === 'openai' ? 'custom' : (source.model_provider || 'custom');
    const spec = buildLaunch(provider.config, commonConfig, provider.commonConfigEnabled, [], process.env);
    const overrides = {};
    for (let i = 0; i < spec.args.length; i += 2) merge(overrides, TOML.parse(spec.args[i + 1]));
    providerConfig = overrides.model_providers[overrides.model_provider];
    for (const key of ['model', 'model_reasoning_effort', 'model_reasoning_summary', 'model_verbosity']) {
      if (overrides[key] !== undefined) config[key] = overrides[key];
    }
    env = Object.fromEntries(Object.entries(spec.env).filter(([key]) => key.startsWith('CCS_CODEX_SESSION_')));
    auth = { auth_mode: 'apikey', OPENAI_API_KEY: provider.config.auth.OPENAI_API_KEY };
  } else {
    tag = 'openai';
    auth = selectOAuth(provider, sharedHome, backendHome, options.ccDir || path.join(os.homedir(), '.cc-switch'));
    const selected = parseConfig(provider.config.config || '', 'Subscription config');
    for (const key of ['model', 'model_reasoning_effort', 'model_reasoning_summary', 'model_verbosity']) {
      if (selected[key] !== undefined) config[key] = selected[key];
    }
    providerConfig = { name: 'OpenAI', wire_api: 'responses', requires_openai_auth: true };
  }
  config.model_provider = tag;
  config.model_providers = tag === 'openai' ? {} : { [tag]: providerConfig };
  config.cli_auth_credentials_store = 'file';
  config.sqlite_home = path.resolve(config.sqlite_home || process.env.CODEX_SQLITE_HOME || sharedHome);
  // Same local rollouts, index, projects and installed tools. Authentication and
  // effective provider configuration are per instance. Never link auth.json.
  for (const name of ['sessions', 'archived_sessions', 'worktrees', 'skills', 'plugins', 'vendor_imports', 'memories', 'rules', 'hooks', 'automations', 'AGENTS.md']) {
    const source = path.join(sharedHome, name), target = path.join(backendHome, name);
    if (!fs.existsSync(source)) {
      if (!['sessions', 'archived_sessions'].includes(name)) continue;
      fs.mkdirSync(source, { recursive: true });
    }
    if (!fs.existsSync(target)) fs.symlinkSync(source, target);
    else if (fs.realpathSync(target) !== fs.realpathSync(source)) throw new Error('实例共享目录与预期不符，已停止启动。');
  }
  privateWrite(path.join(backendHome, 'config.toml'), TOML.stringify(config));
  privateWrite(path.join(backendHome, 'auth.json'), JSON.stringify(auth));
  const paths = appPaths(options.app);
  const manifest = { version: 1, providerName: provider.name, kind: auth.auth_mode, sharedHome, backendHome, desktopDir, cli: paths.cli, env,
    model: config.model || null, providerTag: tag, sqliteHome: config.sqlite_home };
  const manifestFile = path.join(dir, 'launch.json');
  privateWrite(manifestFile, JSON.stringify(manifest));
  const wrapper = path.join(dir, 'codex-wrapper');
  privateWrite(wrapper, desktopWrapper(manifest, config));
  fs.chmodSync(wrapper, 0o700);
  return { ...manifest, dir, manifestFile, wrapper, executable: paths.executable, pidFile };
}
function desktopEnvironment(spec, parentEnv = process.env) {
  const env = { ...parentEnv, CODEX_HOME: spec.sharedHome,
    CODEX_ELECTRON_USER_DATA_PATH: spec.desktopDir, CODEX_CLI_PATH: spec.wrapper };
  // This switch disables WebSocket transport for every host, including durable
  // cloud threads. A private CLI wrapper already isolates the local backend.
  // Let Desktop keep its native remote transport and authenticate it through
  // that selected backend instead of searching cloud IDs in local rollouts.
  delete env.CODEX_APP_SERVER_FORCE_CLI;
  delete env.CODEX_APP_SERVER_WS_URL;
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}
async function launchDesktop(provider, commonConfig = '', options = {}) {
  const spec = prepareDesktop(provider, commonConfig, options);
  const logFile = path.join(spec.dir, 'desktop.log');
  const logOffset = fs.existsSync(logFile) ? fs.statSync(logFile).size : 0;
  const fd = fs.openSync(logFile, 'a', 0o600);
  const env = desktopEnvironment(spec);
  let child;
  try {
    child = spawn(spec.executable, [`--user-data-dir=${spec.desktopDir}`], { env, detached: true, stdio: ['ignore', fd, fd] });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', () => reject(new Error('桌面进程未能启动。'))); });
  } finally { fs.closeSync(fd); }
  child.unref();
  privateWrite(spec.pidFile, JSON.stringify({ pid: child.pid }));
  let startupConfirmed = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    if (!processOwnsInstance(child.pid, spec.desktopDir)) throw new Error('桌面进程启动后退出；请检查该实例的 desktop.log。');
    const log = fs.readFileSync(logFile).subarray(logOffset).toString('utf8');
    if (log.includes('initialize_handshake_result') && log.includes('outcome=success') && log.includes('rendererWindowVisible=true')) { startupConfirmed = true; break; }
  }
  if (!startupConfirmed) throw new Error(`桌面进程已启动（PID ${child.pid}），但尚未确认窗口和后端初始化。请查看窗口提示及 ${logFile}。`);
  console.log(`已启动 Codex 桌面版：${provider.name}\n类型：${spec.kind === 'chatgpt' ? 'ChatGPT 订阅' : 'API'}\nApp 进程：${child.pid}\n窗口：已显示\n后端初始化：已确认\n电脑连接在线状态：未核验\n当前 dot 任务授权：未核验\n任务工作区与命令执行：未核验\n共享本地数据：${spec.sharedHome}\n实例目录：${spec.dir}`);
  return 0;
}
module.exports = { prepareDesktop, launchDesktop, selectOAuth, matchingAuth, processOwnsInstance, desktopEnvironment, desktopWrapper };
