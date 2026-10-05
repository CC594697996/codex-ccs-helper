# 安装说明

需要 Node.js 18 或以上，以及已保存 Codex 配置的 CC Switch。

API CLI 需要终端中可以运行 `codex`。Desktop 和 ChatGPT 订阅 CLI 需要 macOS 与 Codex 桌面应用；订阅配置需要在 CC Switch 中绑定具体账号。

## 从 GitHub 安装

```sh
npm install -g CC594697996/codex-ccs-helper
```

安装完成后运行：

```sh
cxs
```

先选择 CLI 或 Desktop，再选择账号或 API 配置。详细步骤见 [使用说明](README.zh-CN.md)。

## 从源码安装

```sh
git clone https://github.com/CC594697996/codex-ccs-helper.git
cd codex-ccs-helper
npm ci
npm link
```

## 离线安装

在联网的机器上下载源码并打包：

```sh
git clone https://github.com/CC594697996/codex-ccs-helper.git
cd codex-ccs-helper
npm ci
npm pack
```

将生成的 `codex-ccs-helper-0.2.1.tgz` 复制到目标机器，安装：

```sh
npm install -g --offline --ignore-scripts ./codex-ccs-helper-0.2.1.tgz
```

目标机器同样需要 Node.js、CC Switch，以及相应的 Codex CLI 或桌面应用。安装包包含运行依赖；账号与 API 配置由目标机器上的 CC Switch 提供。
