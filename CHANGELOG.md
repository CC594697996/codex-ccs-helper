# Changelog

## 0.2.2 — 2026-10-05

- Generate a POSIX shell wrapper that directly execs the installed native Codex CLI, preserving private account settings without a persistent system Node intermediary. Keep app-server overrides and auxiliary command arguments separate.
- Distinguish confirmed Desktop startup from unverified connection status, dot task authorization, workspace creation and execution.
- Extend the existing wrapper regression test for API and subscription environments, auxiliary commands and authentication-variable removal.
- Document the successful cloud-created local task and Library transfer, with remaining upload, tool discovery and old local-thread access limits. Preserve native device naming.

## 0.2.1 — 2026-10-05

- Preserve native Desktop cloud and local-work routing instead of forcing all hosts to local CLI transport. This fixes durable conversations being looked up as local rollouts while retaining per-account credentials and shared local history.

## 0.2.0 — 2026-10-05

- Merge CLI and Desktop into one package: `cxs` chooses a launch mode, then a CC Switch configuration; `cxd` is the Desktop shortcut.
- Support both API providers and bound ChatGPT accounts. Subscription CLI reuses credential preparation and the desktop app's bundled CLI on macOS.
- Preserve existing named CLI calls and argument passthrough.
- Isolate backend credentials while reusing local Codex projects and history storage.
- Document configuration snapshots, history visibility, account binding and platform limits.
- Add four terminal emulator captures replaying actual zsh menu/help ANSI output with demonstration configurations.

## 0.1.2 — 2026-09-30

- Prepare locked bundled dependencies for GitHub source installation.
- Resolve locked packages from the official npm registry.
- Add GitHub and offline installation instructions.

## 0.1.1 — 2026-09-30

- Add the `cxs` command and bundled offline package for Codex CLI.
