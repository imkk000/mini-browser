# Mini Browser

> **Vibe coding disclaimer:** This project is built with AI assistance (Claude Code). The code works, but it hasn't been audited for edge cases or production hardening. Use at your own discretion.

## Why?

I want to bunch my many applications such as freshrss into single browser without using desktop version.

## Features

- Tabs with isolated persistent sessions (cookies, storage)
- Split panes per tab — view multiple apps side by side
- Drag-to-resize split panes
- External links open in the system browser

## Config

Config file location: `~/.config/mini-browser/apps.json` (Linux) or the Electron `userData` path on your platform.

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

## Preview

<img src="./docs/preview.png" alt="Mini Browser Preview">
