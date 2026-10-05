# Changelog

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
