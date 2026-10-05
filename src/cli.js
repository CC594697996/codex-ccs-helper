#!/usr/bin/env node
'use strict';
const { getProviders, getCommonConfig } = require('./db');
const { launchCLIProvider } = require('./unified-launcher');
const { version } = require('../package.json');

function parseArgs(argv) {
  const args = argv.slice(2), separator = args.indexOf('--');
  const helper = separator < 0 ? args : args.slice(0, separator);
  const codexArgs = separator < 0 ? [] : args.slice(separator + 1);
  let showHelp = false, showVersion = false, showList = false, query = null;
  let desktop = false, cli = false;
  for (const arg of helper) {
    if (arg === '-h' || arg === '--help') showHelp = true;
    else if (arg === '-V' || arg === '--version') showVersion = true;
    else if (arg === '-l' || arg === '--list') showList = true;
    else if (arg === '--desktop') desktop = true;
    else if (arg === '--cli') cli = true;
    else if (!arg.startsWith('-')) {
      if (query !== null) throw new Error('Use one provider name; pass Codex arguments after --.');
      query = arg;
    } else throw new Error('Unknown helper option. See cxs --help; Codex arguments go after --.');
  }
  if (desktop && cli) throw new Error('--cli 和 --desktop 只能选一个。');
  if (desktop && codexArgs.length) throw new Error('Desktop 模式不能传入 -- 后面的 CLI 参数。');
  return { showHelp, showVersion, showList, query, codexArgs, desktop, cli };
}
function printHelp() {
  console.log(`cxs — 从 CC Switch 启动 Codex CLI 或 Desktop

用法：
  cxs                       先选 CLI / Desktop，再选账号或 API 配置
  cxs --cli [name]          直接进入 CLI 的配置选择
  cxs --desktop [name]      直接进入 Desktop 的配置选择（macOS）
  cxs <name>                兼容旧用法：按配置名称启动 CLI
  cxs <name> -- <args...>    向 CLI 传递参数，例如 resume
  cxs --list                列出配置，不启动 Codex
  cxs --version             显示版本
  cxd [name]                Desktop 快捷入口，来自同一个包

上下方向键选择，回车确认，Ctrl-C 退出。`);
}
function printList(providers) {
  console.log('CC Switch 中的 Codex 配置：\n');
  providers.forEach((p, i) => console.log(`  ${i + 1}  ${p.name}${p.isCurrent ? ' (当前)' : ''}`));
}
function fuzzyMatch(providers, query) {
  const matches = providers.filter(p => p.name.toLowerCase().includes(query.toLowerCase()));
  if (!matches.length) { console.error('没有匹配的配置。可用 cxs --list 查看名称。'); return null; }
  return matches.find(p => p.isCurrent) || matches[0];
}
async function interactiveMode() {
  const { mode } = await require('prompts')({
    type: 'select', name: 'mode', message: '选择启动方式',
    choices: [
      { title: 'CLI — 在当前终端启动', value: 'cli' },
      { title: 'Desktop — 启动桌面窗口', value: 'desktop' },
    ],
  });
  return mode || null;
}
async function interactiveSelect(providers) {
  const { selected } = await require('prompts')({
    type: 'select', name: 'selected', message: '选择 CC Switch 账号或 API 配置',
    choices: providers.map(p => ({ title: `${p.name}${p.isCurrent ? ' (当前)' : ''}`, value: p })),
  });
  return selected || null;
}
async function main(argv = process.argv, dependencies = {}) {
  const args = parseArgs(argv);
  if (args.showVersion) { console.log(`cxs ${version}`); return 0; }
  if (args.showHelp) { printHelp(); return 0; }
  let mode = args.desktop ? 'desktop' : args.cli ? 'cli' : null;
  if (!args.showList && !mode) {
    // Preserve existing direct CLI invocations; the bare command is the new menu.
    mode = args.query || args.codexArgs.length ? 'cli' : await (dependencies.selectMode || interactiveMode)();
    if (!mode) return 0;
  }
  if (mode && !['cli', 'desktop'].includes(mode)) throw new Error('启动方式无效。');
  const [providers, commonConfig] = await Promise.all([
    (dependencies.getProviders || getProviders)(),
    (dependencies.getCommonConfig || getCommonConfig)(),
  ]);
  if (args.showList) { printList(providers); return 0; }
  let selected;
  if (args.query) {
    if (mode === 'desktop') {
      const exact = providers.filter(p => p.name.toLowerCase() === args.query.toLowerCase());
      const matches = exact.length ? exact : providers.filter(p => p.name.toLowerCase().includes(args.query.toLowerCase()));
      if (matches.length !== 1) throw new Error('配置名称需唯一；运行 cxs 进行交互选择。');
      selected = matches[0];
    } else selected = fuzzyMatch(providers, args.query);
  } else selected = await (dependencies.selectProvider || interactiveSelect)(providers);
  if (!selected) return args.query ? 1 : 0;
  if (mode === 'desktop') {
    return (dependencies.launchDesktop || require('./desktop').launchDesktop)(selected, commonConfig);
  }
  return (dependencies.launchCLI || launchCLIProvider)(selected, commonConfig, args.codexArgs);
}
if (require.main === module) main().then(code => { process.exitCode = code; }).catch(err => {
  console.error(err.message || '无法运行 Helper，请检查 cxs --help 和 CC Switch 配置。');
  process.exitCode = 1;
});
module.exports = { parseArgs, fuzzyMatch, interactiveMode, interactiveSelect, main };
