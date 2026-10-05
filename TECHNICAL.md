# Implementation notes

## One package, two entry points

`src/cli.js` implements argument parsing and the shared two-level menu. `cxs` without arguments asks for a mode and then a CC Switch configuration. `cxd` is an alias that selects Desktop first. Named `cxs` calls preserve the existing direct CLI path; arguments after `--` are passed only to CLI.

`src/db.js` reads Codex entries from `~/.cc-switch/cc-switch.db` into memory with sql.js. It loads `settings_config`, `meta`, current state and the optional legacy common configuration. A nonempty WAL is rejected to avoid a stale snapshot. The helper does not modify the database.

## API CLI

`src/launcher.js` parses TOML with `@iarna/toml` and creates a fresh provider ID for each process. Codex configuration overrides are passed with `-c`; API keys and static header values are placed in the child environment. Generated arguments and helper logs do not include those secrets.

API providers need an explicit HTTP(S) base URL and the Responses protocol. Chat Completions-only and Anthropic-only routes, command-backed authentication and query-parameter authentication are rejected. This validates configuration shape, not actual remote API compatibility.

Only transport and model-related settings are imported from provider TOML. Ordinary Codex settings remain available from the usual configuration sources. For legacy databases, `meta.commonConfigEnabled = true` explicitly enables common TOML merging, with common values taking precedence.

`src/unified-launcher.js` routes API configurations to this implementation. It routes bound ChatGPT accounts to the same credential preparation used by Desktop, then runs the desktop application's bundled CLI.

## Desktop and subscription credentials

`src/desktop.js` creates a private profile keyed by configuration name and bound account ID. Desktop profiles are stored under `~/Library/Application Support/Codex Desktop Helper/desktop/`; subscription CLI profiles use `~/Library/Application Support/Codex Unified Helper/cli/`.

For subscriptions, `meta.authBinding.accountId` selects an entry from CC Switch's `codex_oauth_auth.json`. An existing native auth snapshot is reused only when its account and JWT subject match and it is at least as recent as the CC Switch cache. Otherwise the saved refresh credentials are prepared for native Codex to refresh. The helper does not implement an OAuth service and does not continuously synchronize private credential refreshes back into CC Switch.

API Desktop profiles use API authentication and a custom provider tag. Subscriptions use the built-in `openai` tag. Private configuration and auth files are written with mode `0600`, with private directories at `0700`.

`src/desktop-backend.js` reads the private launch manifest and invokes the installed native CLI. The desktop process uses `CODEX_CLI_PATH` to reach this wrapper; the wrapper pins effective backend configuration and removes inherited authentication variables that could select an unrelated account.

Desktop launch waits up to 30 seconds for backend handshake success and window-visible log markers. A private PID record and the process's data-directory argument prevent duplicate Desktop instances for the same configuration. Application versions can change the internal launch flags or readiness log markers.

## Shared local storage

The Desktop frontend keeps the original `CODEX_HOME`. The backend uses a private home containing links to existing sessions, archived sessions, worktrees, skills, plugins, vendor imports, memories, rules, hooks, automations and `AGENTS.md`; `sqlite_home` points at the original history index. A base configuration snapshot is combined with the selected provider's transport and model fields. The original `config.toml` and `auth.json` are not rewritten by the helper.

A shared file tree and history index do not guarantee universal conversation visibility. Codex can filter by provider tags. The helper preserves existing tags, does not rewrite old records, and does not merge account-specific cloud content. Running conversations remain owned by their backend. Editing the same project concurrently can produce normal file conflicts.

## Packaging

The package name remains `codex-ccs-helper`, with `cxs` and `cxd` bin entries. The repository is [CC594697996/codex-ccs-helper](https://github.com/CC594697996/codex-ccs-helper). The `private` flag prevents npm registry publication; it does not prevent GitHub installation.

The `prepare` lifecycle performs syntax checks. Dependencies are locked by `npm-shrinkwrap.json`, resolved from `registry.npmjs.org`, and bundled for offline tarballs. There are no `preinstall`, `install` or `postinstall` scripts.

```sh
npm ci
npm run check
npm test
npm pack
```

The resulting `codex-ccs-helper-0.2.0.tgz` can be installed with `npm install -g --offline --ignore-scripts ./codex-ccs-helper-0.2.0.tgz`. User databases, profile directories, credentials and histories are not package contents.

## Verification scope

Existing tests cover configuration parsing, launch isolation, argument/header secrecy, selection, cancellation, dispatch, old CLI calls, synthetic database reading, signals, unsupported routes, WAL refusal and subscription credential isolation.

The API and ChatGPT Desktop paths were started on the development Mac. Native backend initialization, selected account/configuration, local history retrieval and visible windows were checked. The user confirmed both windows were visible. No model inference was sent as part of this work. Windows and Linux runtime behavior was not verified for this merged release.

README terminal images replay actual zsh/PTY ANSI streams in a terminal emulator. The screenshots retain the native CLI menu rendering and use demonstration configurations without credentials. They are not captures of macOS Terminal windows.

## License

MIT. See [LICENSE](LICENSE) and [acknowledgments](UPSTREAM.md).
