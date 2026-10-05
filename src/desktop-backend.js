#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
function main() {
  const manifest = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const env = { ...process.env, ...manifest.env, CODEX_HOME: manifest.backendHome, CODEX_CLI_PATH: manifest.cli };
  delete env.OPENAI_API_KEY;
  delete env.CODEX_API_KEY;
  delete env.CODEX_ACCESS_TOKEN;
  delete env.CODEX_AUTH_TOKEN;
  // App-server reads the shared user config through this private snapshot.
  // Pin provider/auth settings after the desktop's arguments, so its defaults
  // cannot accidentally replace the selected provider.
  const TOML = require('@iarna/toml');
  const config = TOML.parse(fs.readFileSync(path.join(manifest.backendHome, 'config.toml'), 'utf8'));
  const overrides = [];
  for (const key of ['model_provider', 'model_providers', 'model', 'cli_auth_credentials_store', 'sqlite_home']) {
    if (config[key] !== undefined) overrides.push('-c', `${key}=${TOML.stringify.value(config[key])}`);
  }
  const inputArgs = process.argv.slice(3);
  // Auxiliary commands (version, code-mode-host, etc.) need their own CLI syntax.
  const args = inputArgs.includes('app-server') ? [...inputArgs, ...overrides] : inputArgs;
  const child = spawn(manifest.cli, args, { env, stdio: 'inherit' });
  child.once('error', () => { console.error('CXS: 无法启动内置 Codex 后端。'); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.once('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}
try { main(); } catch { console.error('CXS: 桌面后端配置无效，请重新启动此实例。'); process.exitCode = 1; }
