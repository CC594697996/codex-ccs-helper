English | [简体中文](README.zh-CN.md)

# Codex Helper

**Open multiple Codex Desktop windows at once, each using a different API configuration or ChatGPT subscription account.**

Run `cxs` to choose a CC Switch configuration and launch Codex Desktop or Codex CLI. Desktop windows can mix API providers and subscription accounts while reusing local projects and conversation storage. Each instance has independent credentials and keeps its selected configuration.

## Installation

Requires **Node.js 18+** and **CC Switch** with at least one saved Codex configuration.

| Launch mode | Additional requirements |
| --- | --- |
| API → CLI | `codex` available in your terminal |
| API → Desktop | macOS and the Codex desktop app |
| ChatGPT → CLI / Desktop | macOS, the Codex desktop app, and a CC Switch configuration bound to a specific account |

Before using Desktop or a subscription account, open the Codex desktop app normally once to initialize it. Add an API configuration in CC Switch, or sign in to ChatGPT and bind the account.

```sh
npm install -g CC594697996/codex-ccs-helper
```

## Usage

Run:

```sh
cxs
```

### 1. Choose CLI or Desktop

Use the arrow keys to select, Enter to confirm, and Ctrl-C to cancel.

![Choose the launch mode](docs/images/01-mode.jpg)

- **CLI:** runs in the current terminal. Enter your project directory before running `cxs`.
- **Desktop:** opens a desktop window. Select your project from the workspace list after launch.

### 2. Choose an account or API configuration

The menu lists Codex configurations from CC Switch. Select an entry and press Enter to launch.

CLI example:

![CLI configuration selection](docs/images/02-cli.jpg)

Desktop example:

![Desktop configuration selection](docs/images/03-desktop.jpg)

After Desktop starts, the terminal reports the configuration and instance information, then returns control to your shell.

The images use demonstration configuration names and replay actual zsh output in a terminal emulator.

## Running multiple configurations

Run `cxs` again and select another configuration. For example, open one desktop instance with a ChatGPT subscription and another with an API provider, or use separate API configurations in different terminals.

If a Desktop instance is already running for the selected configuration, the helper asks you to use that window. Close the instance and relaunch it to apply configuration changes from CC Switch.

Project files stay in their existing directories, and local conversation files and history indexes are reused. **Shared storage does not guarantee that every window shows every conversation or that conversations can continue across providers.** Cloud conversations, plans and permissions remain account-specific. Running conversations do not automatically synchronize between windows.

## Shortcuts

| Command | Purpose |
| --- | --- |
| `cxs` | Choose a launch mode, then a configuration |
| `cxs --cli` | Go directly to CLI configuration selection |
| `cxs --desktop` | Go directly to Desktop configuration selection |
| `cxs --cli "Personal API"` | Launch CLI by configuration name |
| `cxs --desktop "ChatGPT Plus"` | Launch Desktop by configuration name |
| `cxs --cli "Personal API" -- resume` | Resume a CLI conversation with the selected configuration |
| `cxs --list` | List configurations |
| `cxs --help` | Show help |
| `cxd` | Go directly to Desktop configuration selection |

Replace the example names with names displayed in CC Switch. Desktop name matching must be unique. Pass CLI arguments after `--`.

![Command help](docs/images/04-help.jpg)

## Troubleshooting

**A subscription account cannot launch**

Sign in through CC Switch and bind the configuration to a specific account. A generic “OpenAI Official” entry is insufficient.

**Switching CC Switch configurations does not change an open window**

Each instance keeps its launch-time selection. Close the affected instance and launch it with the desired configuration.

**The database has pending changes**

Quit CC Switch normally and retry.

**The desktop window does not open properly**

Confirm that the Codex desktop app is installed. On launch failure, inspect the instance's `desktop.log` at the path printed in the terminal error.

**A cloud dot cannot create a local task**

The launcher confirms that the App runs, its window appears and its backend initializes. Connection status, task authorization for the current dot, and workspace creation or command execution are reported separately as unverified. Open the relevant dot in the intended Desktop instance and use its native computer connection entry. Before creating a task, have the cloud caller verify that the target connection is online and `is_authorized_for_tasks=true`. When an `environmentId` is supplied explicitly, `attached=false` alone does not block creation.

Instances on the same computer can display the same device name. Helper preserves native naming; identify an instance by its reported PID, profile directory and corresponding registration ID. Cloud access to an existing local conversation depends on the platform interface and account scope. Shared local history does not create a cloud mapping.

See [technical notes](TECHNICAL.md#library-transfer-and-cloud-thread-boundaries) for Library capability discovery, upload timeouts and the verified fallback workflow.

See [installation options](INSTALL.zh-CN.md) for source and offline installation, and [technical notes](TECHNICAL.md) for implementation details.

## License and acknowledgments

Maintained by [CC594697996](https://github.com/CC594697996). Licensed under [MIT](LICENSE).

The initial selection workflow was adapted from [luckybilly/cc-switch-helper](https://github.com/luckybilly/cc-switch-helper).
