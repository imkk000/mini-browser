# Mini Browser

> **Vibe coding disclaimer:** This project is built with AI assistance (Claude Code). The code works, but it hasn't been audited for edge cases or production hardening. Use at your own discretion.

## Why?

I want to bunch my many applications such as freshrss into single browser without using desktop version.

## Features

- Tabs with isolated persistent sessions (cookies, storage)
- Split panes per tab — view multiple apps side by side
- Drag-to-resize split panes
- Collapse/expand individual panes via divider buttons
- Find in page (`Ctrl+F` / `Cmd+F`) with match count and prev/next navigation
- Right-click a tab for refresh, sync typing toggle, and per-pane DevTools
- **Sync typing mode** — type in one pane and all panes in the tab receive the same input simultaneously (tmux-style)
- `F12` opens DevTools for all panes in the active tab
- Edit Config button opens `apps.json` in your default editor
- External links open in the system browser
- Custom user agent — all webviews (including partitioned sessions) send a Chrome UA

## Build & Install

### Linux (Arch)

```bash
npm run dist
npm run install
```

### macOS (Apple Silicon)

```bash
npm run dist:mac
npm run install:mac
```

> `install:mac` mounts the DMG, copies the app to `/Applications`, then ejects the volume.

## Config

Config file location:

- **Linux:** `~/.config/mini-browser/apps.json`
- **macOS:** `~/Library/Application Support/Mini Browser/apps.json`

Each entry is a tab with a `label` and one or more `panes`:

```json
[
  {
    "label": "Google",
    "panes": [{ "url": "https://google.com", "partition": "persist:google" }]
  },
  {
    "label": "Split",
    "panes": [
      { "url": "https://freshrss.example.com", "partition": "persist:rss" },
      { "url": "https://calendar.google.com", "partition": "persist:cal" }
    ]
  }
]
```

### Pane options

| Field       | Required | Description                                      |
|-------------|----------|--------------------------------------------------|
| `url`       | yes      | Initial URL to load                              |
| `partition` | yes      | Session name — use `persist:` prefix to persist across restarts |

## Sync Typing

Right-click any multi-pane tab and toggle **Sync Typing**. A green ⌨ indicator appears on the tab when active.

While enabled, whatever you type in any pane is forwarded to all other visible panes in that tab simultaneously — like tmux's synchronize-panes mode. Collapsed panes are excluded automatically and re-added when expanded.

**Synced inputs:** characters, `Backspace`, `Delete`, `Enter` (including form submit), `Tab`, `Ctrl+A`, `Ctrl+Z` / `Ctrl+Shift+Z` (undo/redo), `Ctrl+Y`, and any other modifier combinations (e.g. `Ctrl+Enter`).

**Before typing:** click into an editable field (input, textarea, rich text editor) in each pane first — sync targets the currently focused element in each pane.

## Preview

<img src="./docs/preview.png" alt="Mini Browser Preview">
