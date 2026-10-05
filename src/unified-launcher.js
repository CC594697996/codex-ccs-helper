'use strict';
const path = require('node:path');
const os = require('node:os');
const { launch, runLaunch, validateExtraArgs } = require('./launcher');

async function launchCLIProvider(provider, commonConfig = '', extraArgs = [], options = {}) {
  if (provider.config.auth?.OPENAI_API_KEY) {
    return launch(provider.name, provider.config, provider.commonConfigEnabled, commonConfig, extraArgs, options);
  }
  validateExtraArgs(extraArgs);
  // Reuse the Desktop provider/auth preparation for a bound subscription.
  // CLI profiles have their own home, so they cannot rewrite a running Desktop
  // instance's launch snapshot. Both still reference the same local history.
  const prepare = options.prepareProfile || require('./desktop').prepareDesktop;
  const profile = prepare(provider, commonConfig, {
    root: path.join(os.homedir(), 'Library/Application Support/Codex Unified Helper/cli'),
    ...(options.profileOptions || {}),
  });
  const env = { ...(options.env || process.env), CODEX_HOME: profile.backendHome, CODEX_CLI_PATH: profile.cli };
  for (const key of ['OPENAI_API_KEY', 'CODEX_API_KEY', 'CODEX_ACCESS_TOKEN', 'CODEX_AUTH_TOKEN']) delete env[key];
  return runLaunch({ command: profile.cli, args: extraArgs, env }, provider.name, options);
}
module.exports = { launchCLIProvider };
