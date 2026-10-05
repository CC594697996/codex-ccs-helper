#!/usr/bin/env node
'use strict';

const spawn = require('cross-spawn');
const TOML = require('@iarna/toml');
const { randomBytes } = require('crypto');
const { constants } = require('os');

function parseConfig(text, label) {
  if (typeof text !== 'string') throw new Error(`${label} must be TOML text.`);
  try { return TOML.parse(text); } catch {
    // TOML parser diagnostics can include the offending line (and credentials).
    throw new Error(`${label} is not valid TOML; check it in CC-Switch.`);
  }
}

function merge(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Unsupported configuration key.');
    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      if (!target[key] || typeof target[key] !== 'object' || Array.isArray(target[key]) || target[key] instanceof Date) target[key] = {};
      merge(target[key], value);
    } else target[key] = value;
  }
  return target;
}

function string(value, label) {
  if (typeof value !== 'string' || !value.trim() || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error(`${label} must be a non-empty single-line string.`);
  }
  return value;
}

function validateExtraArgs(args) {
  // Keep binding authoritative. Config/profile/local-provider flags would let
  // a saved global profile or a later override replace this terminal's choice.
  const forbidden = /^(?:--(?:config|model|profile|oss|local-provider|remote|remote-auth-token-env)(?:=.*|$)|-[cmp](?:.*))$/;
  const mutators = new Set(['agents', 'queue', 'archive', 'unarchive', 'login', 'logout', 'mcp', 'plugin', 'features', 'app-server', 'remote-control', 'cloud', 'exec-server', 'update', 'debug', 'delete', 'migrate-rollouts']);
  // Session subcommands must be first after the helper separator. Otherwise
  // conservatively inspect every token: an option operand named 'exec' must
  // not hide a later management command (e.g. --cd exec logout).
  if (!['exec', 'e', 'resume', 'fork', 'review'].includes(args[0]) && args.some(arg => mutators.has(arg))) {
    throw new Error('Only local Codex sessions are supported. Put exec/resume/fork first after --; run management commands directly with codex.');
  }
  for (const arg of args) {
    if (forbidden.test(arg)) throw new Error('Model, provider, profile and config overrides are not supported after --; select them in CC-Switch.');
  }
}

function buildLaunch(providerConfig, commonConfig = '', commonConfigEnabled = false, extraArgs = [], parentEnv = process.env) {
  validateExtraArgs(extraArgs);
  if (!providerConfig || typeof providerConfig !== 'object') throw new Error('Invalid Codex provider settings.');
  const config = parseConfig(providerConfig.config, 'Provider config');
  if (commonConfigEnabled && commonConfig) merge(config, parseConfig(commonConfig, 'Common Codex config'));
  const model = string(config.model, 'Codex model');
  const sourceId = string(config.model_provider, 'Codex model_provider');
  const source = config.model_providers?.[sourceId];
  if (!source || typeof source !== 'object') throw new Error('Selected model_provider must have a model_providers table and explicit base_url.');
  if (source.wire_api !== undefined && source.wire_api !== 'responses') throw new Error('Only Responses API providers are supported; wire_api must be "responses".');
  if (source.auth || source.experimental_bearer_token || source.query_params) throw new Error('Command/token/query-parameter authentication is unsupported; use auth.OPENAI_API_KEY.');
  let url;
  try { url = new URL(string(source.base_url, 'Provider base_url')); } catch { throw new Error('Provider base_url must be a valid HTTP(S) URL.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Provider base_url must be HTTP(S), without credentials, query or fragment.');
  if (/\/(?:chat\/completions|messages|responses)\/?$/.test(url.pathname)) throw new Error('Use the API base URL (usually ending /v1), not a messages/chat/completions/responses route.');
  const apiKey = string(providerConfig.auth?.OPENAI_API_KEY, 'auth.OPENAI_API_KEY');
  // Random identifier is not a credential. A fresh table cannot accidentally
  // inherit extra headers/auth from a same-named global provider table.
  const id = `ccs_${randomBytes(12).toString('hex')}`;
  const envKey = 'CCS_CODEX_SESSION_API_KEY';
  const env = { ...parentEnv, [envKey]: apiKey };
  const provider = { name: 'CCS session provider', base_url: url.href.replace(/\/$/, ''), wire_api: 'responses', env_key: envKey, requires_openai_auth: false };
  for (const key of ['http_headers', 'env_http_headers']) {
    if (source[key] !== undefined && (!source[key] || typeof source[key] !== 'object' || Array.isArray(source[key]))) throw new Error('Provider HTTP headers must be a TOML table.');
  }
  const headers = {};
  let index = 0;
  for (const [name, value] of Object.entries(source.http_headers || {})) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) throw new Error('Invalid HTTP header name.');
    const key = `CCS_CODEX_SESSION_HEADER_${index++}`;
    env[key] = string(value, 'HTTP header value');
    headers[name] = key;
  }
  for (const [name, variable] of Object.entries(source.env_http_headers || {})) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) throw new Error('Invalid HTTP header name.');
    const key = `CCS_CODEX_SESSION_HEADER_${index++}`;
    env[key] = string(parentEnv[variable], 'HTTP header environment variable');
    headers[name] = key;
  }
  if (Object.keys(headers).length) provider.env_http_headers = headers;
  for (const key of ['request_max_retries', 'stream_max_retries', 'stream_idle_timeout_ms']) {
    if (source[key] !== undefined) {
      if (!Number.isSafeInteger(source[key]) || source[key] < 0) throw new Error('Provider retry/timeouts must be non-negative integers.');
      provider[key] = source[key];
    }
  }
  if (source.supports_websockets !== undefined) {
    if (typeof source.supports_websockets !== 'boolean') throw new Error('supports_websockets must be boolean.');
    provider.supports_websockets = source.supports_websockets;
  }
  const overrides = { model, model_provider: id, [`model_providers.${id}`]: provider };
  for (const key of ['model_reasoning_effort', 'model_reasoning_summary', 'model_verbosity']) {
    if (config[key] !== undefined) overrides[key] = string(config[key], key);
  }
  const args = [];
  for (const [key, value] of Object.entries(overrides)) {
    args.push('-c', `${key}=${TOML.stringify.value(value)}`);
  }
  args.push(...extraArgs);
  return { command: process.platform === 'win32' ? 'codex.cmd' : 'codex', args, env };
}

function launch(providerName, providerConfig, commonConfigEnabled, commonConfig, extraArgs = [], opts = {}) {
  const spec = buildLaunch(providerConfig, commonConfig, commonConfigEnabled, extraArgs, opts.env || process.env);
  return runLaunch(spec, providerName, opts);
}

function runLaunch(spec, providerName, opts = {}) {
  const log = opts.log || console;
  // Never print configuration, arguments, exception payloads or environment.
  const safeName = String(providerName).replace(/[\x00-\x1f\x7f]/g, '').split(spec.env.CCS_CODEX_SESSION_API_KEY).join('[redacted]');
  log.log(`→ Launching [${safeName}] with Codex`);
  return new Promise((resolve) => {
    let child;
    const handlers = new Map();
    let settled = false;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      for (const [signal, handler] of handlers) process.removeListener(signal, handler);
      resolve(code);
    };
    try { child = (opts.spawn || spawn)(spec.command, spec.args, { stdio: 'inherit', env: spec.env, shell: false }); }
    catch { log.error('Failed to start Codex CLI. Check that codex is installed and on PATH.'); finish(1); return; }
    for (const signal of ['SIGINT', 'SIGTERM']) {
      const handler = () => { if (!child.killed) child.kill(signal); };
      handlers.set(signal, handler);
      process.on(signal, handler);
    }
    child.once('error', () => { log.error('Failed to start Codex CLI. Check that codex is installed and on PATH.'); finish(1); });
    child.once('exit', (code, signal) => finish(code ?? (signal ? 128 + (constants.signals[signal] || 1) : 1)));
  });
}

module.exports = { launch, runLaunch, buildLaunch, parseConfig, merge, validateExtraArgs };
