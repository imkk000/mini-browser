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
- **Privacy hardening** — Sec-CH-UA + `navigator.userAgentData` spoofed to match the UA, locked `Accept-Language`, trimmed `Referer`, stripped `Upgrade-Insecure-Requests` / `Available-Dictionary` / dictionary headers, WebRTC LAN-IP leak blocked, permissions deny-by-default
- **Per-pane SOCKS5/HTTP proxy** with embedded credentials (`socks5://user:pass@host:port`)
- **DNS-over-HTTPS** (app-wide) — configurable mode and server(s)

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

Two formats are accepted. **Legacy** — top-level array of tabs (still works):

```json
[
  {
    "label": "Google",
    "panes": [{ "url": "https://google.com", "partition": "persist:google" }]
  }
]
```

**New** — object with optional app-wide settings (`doh`):

```json
{
  "doh": "https://cloudflare-dns.com/dns-query",
  "tabs": [
    {
      "label": "Mail",
      "panes": [
        {
          "url": "https://mail.proton.me",
          "partition": "persist:proton",
          "proxy": "socks5://127.0.0.1:1080"
        }
      ]
    },
    {
      "label": "Split",
      "panes": [
        { "url": "https://github.com", "partition": "persist:gh", "proxy": "socks5://user:pass@10.0.0.5:1080" },
        { "url": "https://linear.app", "partition": "persist:linear" }
      ]
    }
  ]
}
```

### Pane options

| Field       | Required                  | Description                                      |
|-------------|---------------------------|--------------------------------------------------|
| `url`       | yes                       | Initial URL to load                              |
| `partition` | yes if `proxy` is set     | Session name — use `persist:` prefix to persist across restarts |
| `proxy`     | no                        | `socks5://`, `socks4://`, `http://`, or `https://` URL. Embedded `user:pass@` is wired through `app.on('login')`. Per-session, so panes sharing a `partition` share one proxy (first wins). |

### Top-level options

| Field   | Description                                                                                       |
|---------|---------------------------------------------------------------------------------------------------|
| `doh`   | DoH config. String = DoH URL with default `secure` mode. Object: `{ "mode": "secure" \| "automatic" \| "off", "servers": ["https://..."] }`. App-wide via `app.configureHostResolver` — Electron does not support per-session DoH. Does not apply to destinations routed through a SOCKS5 proxy (the proxy resolves those). |
| `tabs`  | Array of tab objects (same shape as the legacy top-level array).                                  |

> **Restart required** to pick up `proxy` or `doh` changes — both are configured at startup.

## Privacy notes

The app applies session hardening at startup:

- UA + `Sec-CH-UA-*` + `navigator.userAgentData` spoofed to a current Chrome on Windows (kept in sync with the bundled Chromium so JS APIs match)
- `Accept-Language` pinned to `en-US,en;q=0.9`; system locale never leaks
- `Referer` trimmed to origin
- `Upgrade-Insecure-Requests`, `Available-Dictionary`, `Sec-Available-Dictionary`, `Dictionary-Id` stripped
- `Accept-Encoding` forced to `gzip, deflate`
- WebRTC LAN-IP leak prevented (`webrtc-ip-handling-policy=default_public_interface_only`)
- Permissions deny-by-default; only `media`, `display-capture`, `fullscreen`, `pointerLock`, `clipboard-sanitized-write` auto-granted

**Trade-offs you should know.** Stripping `Upgrade-Insecure-Requests` and forcing `Accept-Encoding: gzip, deflate` are privacy-positive but also unusual enough that anti-bot vendors (Google reCAPTCHA, Cloudflare) score them as suspicious. If you start hitting captchas more often, restoring those two to Chrome's defaults is the obvious fix. JA3/TLS fingerprint comes from Electron's bundled Chromium and cannot be changed without rebuilding Electron.

## Sync Typing

Right-click any multi-pane tab and toggle **Sync Typing**. A green ⌨ indicator appears on the tab when active.

While enabled, whatever you type in any pane is forwarded to all other visible panes in that tab simultaneously — like tmux's synchronize-panes mode. Collapsed panes are excluded automatically and re-added when expanded.

**Synced inputs:** characters, `Backspace`, `Delete`, `Enter` (including form submit), `Tab`, `Ctrl+A`, `Ctrl+Z` / `Ctrl+Shift+Z` (undo/redo), `Ctrl+Y`, and any other modifier combinations (e.g. `Ctrl+Enter`).

**Before typing:** click into an editable field (input, textarea, rich text editor) in each pane first — sync targets the currently focused element in each pane.

## Roadmap

Ideas under consideration for daily-use polish (not yet implemented):

- **Per-domain permission allowlist** in `apps.json` so `notifications` / `geolocation` / etc. can be granted to specific origins (Slack, Discord, calendars) without weakening the global deny-by-default
- **Persistent layout state** — pane sizes, last-active tab, scroll position written to a state file in `userData` and restored on launch
- **Keyboard navigation** — `Ctrl+1..9` jump to tab, `Ctrl+R` reload focused pane, `Ctrl+W` close-or-collapse pane
- **Per-pane mute toggle** in the tab right-click menu (via `webContents.setAudioMuted`)
- **Per-pane auto-reload interval** for dashboards / RSS (`"reload": 300` in seconds)
- **Profile switcher** — pick between multiple `apps.json` files (work / personal)
- **Per-pane userCSS** — inject custom styles for forced dark mode etc.
- **Back / forward buttons** per pane

## Preview

<img src="./docs/preview.png" alt="Mini Browser Preview">
