const { app, BrowserWindow, ipcMain, shell, webContents } = require("electron");
app.commandLine.appendSwitch("enable-features", "WebviewTag");
const path = require("path");
const fs = require("fs");

// Sync typing: wcId -> Set of peer wcIds to forward keyboard events to
const syncGroups = new Map();

// Maps a before-input-event to a document.execCommand script for peer panes.
// executeJavaScript never triggers before-input-event, so no feedback loop is possible.
function buildDispatchScript(input) {
  const init = JSON.stringify({
    key: input.key, code: input.code,
    ctrlKey: !!input.control, metaKey: !!input.meta,
    shiftKey: !!input.shift, altKey: !!input.alt,
    bubbles: true, cancelable: true,
  });
  return `(document.activeElement||document.body).dispatchEvent(new KeyboardEvent('keydown',${init}))`;
}

function buildSyncScript(input) {
  if (input.type !== "keyDown" && input.type !== "rawKeyDown") return null;
  if (input.control || input.meta) {
    switch (input.key.toLowerCase()) {
      case "a": return `document.execCommand('selectAll')`;
      case "z": return input.shift ? `document.execCommand('redo')` : `document.execCommand('undo')`;
      case "y": return `document.execCommand('redo')`;
    }
    // Any other ctrl/meta combo (e.g. Ctrl+Enter, Ctrl+K): dispatch as KeyboardEvent
    return buildDispatchScript(input);
  }
  if (input.key.length === 1) {
    return `document.execCommand('insertText',false,${JSON.stringify(input.key)})`;
  }
  switch (input.key) {
    case "Backspace": return `document.execCommand('delete')`;
    case "Delete":    return `document.execCommand('forwardDelete')`;
    case "Enter":     return `(function(){var el=document.activeElement||document.body;el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,cancelable:true}));var f=el.closest&&el.closest('form');if(f){var ev=new Event('submit',{bubbles:true,cancelable:true});f.dispatchEvent(ev);if(!ev.defaultPrevented)f.submit();}})()`;
    case "Tab":       return `document.execCommand('insertText',false,'\\t')`;
  }
  return null;
}

const DEFAULT_APPS = [];

function getConfigPath() {
  return path.join(app.getPath("userData"), "apps.json");
}

function loadApps() {
  const cfgPath = getConfigPath();
  if (!fs.existsSync(cfgPath)) {
    // Write a default config on first run
    fs.writeFileSync(cfgPath, JSON.stringify(DEFAULT_APPS, null, 2));
    return DEFAULT_APPS;
  }
  try {
    return JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
  } catch (e) {
    console.error("Invalid apps.json, using defaults:", e.message);
    return DEFAULT_APPS;
  }
}

// Respond to renderer asking for apps
ipcMain.handle("get-apps", () => {
  return loadApps();
});

const SAFE_PROTOCOLS = new Set(["https:", "http:"]);

function isSafeUrl(url) {
  try {
    return SAFE_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

ipcMain.handle("open-external", (_, url) => {
  if (!isSafeUrl(url)) return;
  shell.openExternal(url);
});

ipcMain.handle("set-sync-group", (_, wcIds, enable) => {
  // Remove these wcIds from any existing sync group first
  wcIds.forEach(id => {
    if (syncGroups.has(id)) {
      const peers = syncGroups.get(id);
      peers.forEach(peerId => {
        const peerGroup = syncGroups.get(peerId);
        if (peerGroup) {
          peerGroup.delete(id);
          if (peerGroup.size === 0) syncGroups.delete(peerId);
        }
      });
      syncGroups.delete(id);
    }
  });
  if (enable && wcIds.length > 1) {
    wcIds.forEach(id => {
      syncGroups.set(id, new Set(wcIds.filter(p => p !== id)));
    });
  }
});

// Intercept all webview navigations at the main process level
app.on("web-contents-created", (_, contents) => {
  // Only apply to webviews, not the main window
  if (contents.getType() !== "webview") return;

  // Intercept Ctrl+F so the webview doesn't swallow it
  contents.on("before-input-event", (e, input) => {
    if ((input.control || input.meta) && input.key.toLowerCase() === "f" && (input.type === "keyDown" || input.type === "rawKeyDown")) {
      e.preventDefault();
      const win = BrowserWindow.getAllWindows()[0];
      if (win) win.webContents.send("open-find-bar");
      return;
    }

    if (!contents.isFocused()) return;
    const peers = syncGroups.get(contents.id);
    if (!peers || peers.size === 0) return;
    const script = buildSyncScript(input);
    if (!script) return;
    peers.forEach(peerId => {
      const peer = webContents.fromId(peerId);
      if (peer && !peer.isDestroyed()) peer.executeJavaScript(script).catch(() => {});
    });
  });

  // Forward found-in-page results back to the renderer
  contents.on("found-in-page", (_, result) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) win.webContents.send("found-in-page-result", contents.id, result);
  });

  // Block external navigation and open in system browser
  contents.on("will-navigate", (e, url) => {
    try {
      const current = new URL(contents.getURL());
      const next = new URL(url);
      if (next.hostname !== current.hostname || next.port !== current.port) {
        e.preventDefault();
        if (isSafeUrl(url)) shell.openExternal(url);
      }
    } catch {
      e.preventDefault();
    }
  });

  // Also handle target="_blank" links
  contents.setWindowOpenHandler(({ url }) => {
    if (isSafeUrl(url)) shell.openExternal(url);
    return { action: "deny" };
  });
});

// Find in page via main process (reliable for webviews)
ipcMain.handle("webview-find", (_, wcId, text, options) => {
  if (typeof text !== "string" || !text) return;
  const wc = webContents.fromId(wcId);
  if (!wc || wc.isDestroyed() || wc.getType() !== "webview") return;
  wc.findInPage(text, {
    forward: options?.forward !== false,
    findNext: options?.findNext === true,
  });
});

ipcMain.handle("webview-stop-find", (_, wcId) => {
  const wc = webContents.fromId(wcId);
  if (!wc || wc.isDestroyed() || wc.getType() !== "webview") return;
  wc.stopFindInPage("clearSelection");
});

// Let renderer open config file in default editor
ipcMain.handle("open-config", () => {
  shell.openPath(getConfigPath());
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "Mini Browser",
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
    },
  });

  win.loadFile("renderer/index.html");
  win.setMenuBarVisibility(false);
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
