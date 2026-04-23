# Mini Browser — CLAUDE.md

## Project overview

Electron app that wraps multiple web apps into a single window with tabs and split panes. No build step, no framework — single-file renderer.

**Key files:**
- `main.js` — main process: IPC handlers, navigation safety, sync typing, user agent
- `preload.js` — contextBridge exposing `window.electronAPI` to renderer
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

```json
[
  {
    "label": "Tab name",
    "panes": [
      { "url": "https://example.com", "partition": "persist:name" }
    ]
  }
]
```

Multiple entries in `panes` create a split-pane layout. `partition` is optional; use `persist:` prefix to keep cookies/storage across restarts.

## Architecture notes

### User agent
`CHROME_UA` is set on `defaultSession` at startup and on every new session via the `session-created` event. This ensures partitioned webviews also use the custom UA — setting only `defaultSession` is not enough.

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
