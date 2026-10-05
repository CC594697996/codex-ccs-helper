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

`src/desktop.js` generates a private POSIX shell wrapper reached through Desktop's `CODEX_CLI_PATH`. The wrapper exports the private backend home and selected provider variables, removes inherited authentication variables that could select an unrelated account, then directly `exec`s the installed native CLI. The shell is replaced, so no system Node intermediary remains in the native backend's process ancestry. Only app-server commands receive provider, model, credential-store and history-directory overrides; auxiliary commands retain their original arguments. `src/desktop-backend.js` remains available for older wrappers, but new launches do not use it. An already-running process keeps its previous ancestry until it is restarted normally.

Desktop launch waits up to 30 seconds for backend handshake success and window-visible log markers. This confirms startup only. Output separately marks computer connection status, authorization for the current dot, and task workspace creation or command execution as unverified. A private PID record and the process's data-directory argument prevent duplicate Desktop instances for the same configuration. Desktop keeps native WebSocket routing for durable cloud threads and local-work connections. The launcher removes inherited `CODEX_APP_SERVER_FORCE_CLI`, `CODEX_APP_SERVER_WS_URL` and `ELECTRON_RUN_AS_NODE`: forcing every host to CLI transport would send cloud conversation IDs to the local backend, producing `no rollout found`. Application versions can change the internal launch flags or readiness log markers.

Cloud creation requires the intended connection to be online and authorized for tasks in that dot. A successful rendezvous connection does not establish that authorization. When the caller specifies `environmentId`, `attached=false` alone is not an independent blocker; `is_authorized_for_tasks` must actually be true. Native connection operations should target the matching dot and instance, with the cloud caller checking the resulting authorization before creation.

Device registration and display names remain managed by the native App. Helper does not change the system hostname, override device names or recreate registration IDs. Multiple profiles may have different connection IDs while displaying the same device name. Use the instance directory, App PID and that instance's actual executor registration to distinguish them.

## Shared local storage

The Desktop frontend keeps the original `CODEX_HOME`. The backend uses a private home containing links to existing sessions, archived sessions, worktrees, skills, plugins, vendor imports, memories, rules, hooks, automations and `AGENTS.md`; `sqlite_home` points at the original history index. A base configuration snapshot is combined with the selected provider's transport and model fields. The original `config.toml` and `auth.json` are not rewritten by the helper.

A shared file tree and history index do not guarantee universal conversation visibility. Codex can filter by provider tags. The helper preserves existing tags, does not rewrite old records, and does not merge account-specific cloud content. Running conversations remain owned by their backend. Editing the same project concurrently can produce normal file conflicts.

## Library transfer and cloud thread boundaries

This package has no Library upload client or `tools/list` implementation. The current local maintenance session also exposes no `prepare_uploads`, `create_library_file` or `prepare_materialize` tool. The cloud session's tool-discovery mismatch cannot be reproduced through this session's tool entry, and there is no evidence tying it to the launcher's environment or routing.

The user's 2026-10-05 cloud test reported that the official batch upload helper's actual `tools/list` entry lacked `prepare_uploads`, although the session catalog advertised that name. A parameter-validation error from an empty call did not establish prepared-upload support. The skill-permitted fallback using the official `create_library_file(files=[...])` interface successfully transferred two spreadsheets and a 75,444,391-byte ZIP through Library into the consumer's cloud workspace. Official helper internals and timeout settings were not changed.

A 384,646,143-byte ZIP exceeded the direct-upload timeout at 300001 ms. It was then transported as 12 consecutive binary parts of at most 32 MiB through the same official Library interface, reassembled in part-number order, checked for matching total length and successfully extracted. This verified a transport fallback; the native single-request upload timeout remains unresolved.

For that fallback, retain the original file and record each successfully saved Library ID in the caller's existing transfer state. If a batch times out or omits per-file results, first check which files were actually saved, then retry only confirmed missing items. Resume parts in their original order and keep transport parts outside the final project contents. Do not treat an unknown outcome as a failed upload or reupload successful files without evidence.

Receipt also requires localization through the current Library skill. During the reported test, materializing to `/workspace/shared` returned a signed URL whose download failed with HTTP 502. Materializing into the consuming conversation's current workspace instead returned a readable `workspace_path`. A Mac path or Library ID alone does not establish cloud receipt.

Separately, cloud access to an existing local conversation reported `unsupported placement format version 2` on read and `CloudThreadNotFoundError` on send. That does not establish that the local conversation is absent, and does not invalidate the successful newly created local task. Helper does not rewrite conversation IDs, rollouts or databases to fabricate a cloud mapping; existing-thread access remains a platform and account-scope limitation.

## Packaging

The package name remains `codex-ccs-helper`, with `cxs` and `cxd` bin entries. The repository is [CC594697996/codex-ccs-helper](https://github.com/CC594697996/codex-ccs-helper). The `private` flag prevents npm registry publication; it does not prevent GitHub installation.

The `prepare` lifecycle performs syntax checks. Dependencies are locked by `npm-shrinkwrap.json`, resolved from `registry.npmjs.org`, and bundled for offline tarballs. There are no `preinstall`, `install` or `postinstall` scripts.

```sh
npm ci
npm run check
npm test
npm pack
```

The resulting `codex-ccs-helper-0.2.2.tgz` can be installed with `npm install -g --offline --ignore-scripts ./codex-ccs-helper-0.2.2.tgz`. User databases, profile directories, credentials and histories are not package contents.

## Verification scope

Existing tests cover configuration parsing, launch isolation, argument/header secrecy, selection, cancellation, dispatch, old CLI calls, synthetic database reading, signals, unsupported routes, WAL refusal and subscription credential isolation.

The API and ChatGPT Desktop paths were started on the development Mac. Native backend initialization, selected account/configuration, local history retrieval and visible windows were checked. The wrapper regression test verifies process replacement by PID, argument quoting, provider overrides, auxiliary command passthrough and API/subscription environment isolation.

The user's cloud-side test report provides stronger evidence for the repaired formal instance: on 2026-10-05 at 17:31 Beijing time, its connection was online, attached and authorized for tasks. A new task was created and ran `pwd` at 17:32:28 with exit code 0 before completing. The Library transfers above also reached the consumer's workspace, and the split large ZIP was extracted at 18:07. These results verify that tested instance's task and transfer paths. They do not establish that every historical workspace failure was caused by Node ancestry, or resolve the remaining upload and old-thread limits. Windows and Linux runtime behavior was not verified for this merged release.

README terminal images replay actual zsh/PTY ANSI streams in a terminal emulator. The screenshots retain the native CLI menu rendering and use demonstration configurations without credentials. They are not captures of macOS Terminal windows.

## License

MIT. See [LICENSE](LICENSE) and [acknowledgments](UPSTREAM.md).
