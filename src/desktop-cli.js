#!/usr/bin/env node
'use strict';
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`cxd — 从 CC Switch 启动 Codex 桌面实例（macOS）

用法：
  cxd                 选择一条 API 或 ChatGPT 订阅配置并启动桌面版
  cxd "配置名称"      按名称启动；名称需唯一
  cxd --list          列出 CC Switch 中的 Codex 配置
  cxd --version       查看版本

每条配置使用独立认证和浏览器目录，沿用原 Codex 的本地历史及工作区。
运行中的实例保持启动时的配置。关闭对应窗口后重新运行可更新配置。
也可以运行 cxs，在第一层菜单选择 Desktop。`);
} else {
  process.argv.splice(2, 0, '--desktop');
  require('./cli').main().then(code => { process.exitCode = code; }).catch(err => {
    console.error(err.message || '无法启动桌面实例。');
    process.exitCode = 1;
  });
}
