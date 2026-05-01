# Mini Browser — CLAUDE.md

## Project overview

Electron app that wraps multiple web apps into a single window with tabs and split panes. No build step, no framework — single-file renderer.

**Key files:**
- `main.js` — main process: IPC handlers, navigation safety, sync typing, session hardening, proxies, DoH
- `preload.js` — contextBridge exposing `window.electronAPI` to renderer (host window only)
- `renderer/webview-preload.js` — runs in every webview frame; spoofs `navigator.userAgentData` / `platform` / `languages` / `webdriver` to match the HTTP-level UA
- `renderer/index.html` — all UI + JS in one file (tabs, panes, find bar, sync mode)
- `apps.json` — user config at Electron `userData` path (`~/.config/mini-browser/` on Linux)

## Running

```sh
npm start
```

## Building

```sh
npm run dist        # Linux
npm run dist:mac    # macOS arm64
```

## Config format (`apps.json`)

Two formats are accepted. Legacy (top-level array of tabs):

```json
[
  {
    "label": "Tab name",
    "panes": [
      { "url": "https://example.com", "partition": "persist:name", "proxy": "socks5://user:pass@127.0.0.1:1080" }
    ]
  }
]
```

New (object with optional app-wide settings):

```json
{
  "doh": "https://cloudflare-dns.com/dns-query",
  "tabs": [
    { "label": "...", "panes": [ ... ] }
  ]
}
```

Multiple entries in `panes` create a split-pane layout. `partition` is optional; use `persist:` prefix to keep cookies/storage across restarts. `proxy` is optional and accepts any Chromium-supported URL (`socks5://`, `socks4://`, `http://`, `https://`); credentials embedded in the URL are answered via `app.on('login')`. Proxy is per-**session**, so a pane with `proxy` must also have `partition` (panes sharing a partition share one proxy — first config wins, conflicts are logged).

`doh` is optional and applies app-wide via `app.configureHostResolver`. Accepts either a string (DoH URL, mode defaults to `secure`) or an object `{ "mode": "secure" | "automatic" | "off", "servers": ["https://..."] }`. `secure` mode requires DoH to succeed (no fallback to system DNS); `automatic` falls back. DoH does not apply to destinations routed through a SOCKS5 proxy — the proxy resolves those.

## Architecture notes

### Session hardening
`hardenSession(sess)` is applied to `defaultSession` at startup and to every session created later (`app.on('session-created')`). It does:

- **UA spoof** — `setUserAgent(CHROME_UA, "en-US,en")`. UA claims Windows + Chrome `CHROME_VERSION` (kept in sync with the bundled Chromium so the JS API surface matches the spoof). Second arg pins `Accept-Language`.
- **Webview preload** — appends `renderer/webview-preload.js` via `setPreloads([...])` (deduped, preserves any existing). The preload uses `webFrame.executeJavaScript` to override `navigator.userAgentData`, `navigator.platform` → `Win32`, `navigator.languages` → `["en-US","en"]`, `navigator.webdriver` → `false`.
- **Header rewrite** in `webRequest.onBeforeSendHeaders`:
  - `Sec-Ch-Ua` / `Sec-Ch-Ua-Mobile` / `Sec-Ch-Ua-Platform` overridden on HTTPS, deleted on HTTP (matches real Chrome behavior).
  - `Accept-Language` pinned to `en-US,en;q=0.9`.
  - `Accept-Encoding` forced to `gzip, deflate` (drops `br`, `zstd`).
  - `Upgrade-Insecure-Requests`, `Available-Dictionary`, `Sec-Available-Dictionary`, `Dictionary-Id` deleted.
  - `Referer` trimmed to origin only via `new URL(ref).origin`.
- **Permissions** — `setPermissionRequestHandler` + `setPermissionCheckHandler` deny by default. Allowlist: `media`, `display-capture`, `fullscreen`, `pointerLock`, `clipboard-sanitized-write`. Electron's default is *grant all*, so this is a meaningful tightening.

`webrtc-ip-handling-policy=default_public_interface_only` is appended via `app.commandLine` to stop LAN-IP STUN leaks.

**Trade-off knobs** — these spoofs/strips diverge from real Chrome and can trigger anti-bot challenges (Google reCAPTCHA, Cloudflare):
- Forcing `Accept-Encoding: gzip, deflate` and dropping `Upgrade-Insecure-Requests` are the loudest tells. If captchas are unbearable, restore both to match Chrome 146 (`gzip, deflate, br, zstd` and `Upgrade-Insecure-Requests: 1` on top-level navigations).
- Always-trimmed `Referer` is stricter than Chrome's default `strict-origin-when-cross-origin`. Softening to cross-origin-only is the obvious dial-down.

### Proxies (per session)
`configureProxies(tabs)` runs at startup, after `hardenSession` (so partitioned sessions are already hardened by the time `setProxy` runs). Walks panes, builds `partition → proxy` map, calls `session.fromPartition(p).setProxy({ proxyRules, proxyBypassRules: "<local>" })`. URL credentials are extracted into a `proxyAuth` map; `app.on('login')` answers proxy auth challenges from that map.

Constraints baked into the design:
- **Proxy is per-session, not per-webview** in Electron. A pane with `proxy` must also set `partition`. Panes sharing a partition share one proxy — first wins, conflicts logged.
- `<local>` bypass keeps localhost direct.
- Restart required to pick up proxy config changes.

### DoH (DNS-over-HTTPS, app-wide)
`applyDoh(doh)` calls `app.configureHostResolver({ enableBuiltInResolver: true, secureDnsMode, secureDnsServers })`. **Per-session DoH is not supported by Electron** — `configureHostResolver` is process-global and there's no `Session.setSecureDns`. For per-pane DNS isolation, use `proxy` (SOCKS5 proxies resolve hostnames at the proxy, so each pane's DNS path follows its proxy). DoH only applies to non-proxied destinations.

### User agent
The Chrome version in `CHROME_UA` and `SEC_CH_UA` should track the Chromium version bundled with the current Electron major (Electron 41 → Chromium 146, etc.). Mismatched versions cause anti-bot scoring AND can cause real JS API breaks if the spoofed version claims newer-than-actual Chromium.

### Sync typing
Forwards keystrokes from the focused pane to all other visible panes in the active tab (tmux synchronize-panes style).

- `before-input-event` in main process intercepts keys; `contents.isFocused()` guards against loops
- Injection via `executeJavaScript` + `document.execCommand` — **not** `sendInputEvent` (that triggers `before-input-event` on the target and freezes the app)
- Modifier combos not covered by `execCommand` are dispatched as synthetic `KeyboardEvent`
- `Enter` dispatches a `KeyboardEvent` AND submits the nearest `<form>`
- Collapsed panes are excluded from the sync group automatically

State: `tabSyncMode[]` / `allTabWebviews[]` in renderer; `syncGroups` Map in main; IPC: `set-sync-group(wcIds, enable)`.

### Navigation safety
Cross-origin navigations are blocked in `will-navigate` and `setWindowOpenHandler` — they open in the system browser via `shell.openExternal`. Only `http:` and `https:` are allowed.

### Find in page
`Ctrl+F` is intercepted in `before-input-event` (before the webview can swallow it) and triggers `wc.findInPage` via IPC. Results are forwarded back to the renderer via `found-in-page-result`.

## Coding conventions

- Keep everything in the existing files — no new modules, no bundler, no framework
- All UI lives in `renderer/index.html`; IPC bridge stays in `preload.js`
- Keep responses concise — lead with the fix

## Roadmap (not implemented)

Candidate features the user is considering. Don't implement unless asked, but design choices below should leave room for them:

- **Per-domain permission allowlist** in `apps.json` (override global deny-by-default for specific origins) — would extend `setPermissionRequestHandler` to inspect the requesting frame's origin
- **Persistent layout state** — pane sizes, last-active tab, scroll position; separate state file in `userData`, written on resize/tab-switch
- **Keyboard nav** — `Ctrl+1..9` tab jump, `Ctrl+R` focused-pane reload, `Ctrl+W` close-or-collapse; intercept in renderer with care not to swallow shortcuts apps care about
- **Per-pane mute** via `webContents.setAudioMuted` in the right-click menu
- **Per-pane auto-reload interval** (`"reload": 300` seconds in the pane config)
- **Profile switcher** — multiple `apps.json` files
- **Per-pane userCSS** — `webContents.insertCSS` on `dom-ready`
- **Back / forward buttons** per pane
