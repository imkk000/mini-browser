const {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  webContents,
  session,
} = require("electron");
app.commandLine.appendSwitch("enable-features", "WebviewTag");
// Stops WebRTC from leaking LAN IPs via STUN — only public iface is exposed.
app.commandLine.appendSwitch("webrtc-ip-handling-policy", "default_public_interface_only");
const path = require("path");
const fs = require("fs");

// Sync typing: wcId -> Set of peer wcIds to forward keyboard events to
const syncGroups = new Map();

// Maps a before-input-event to a document.execCommand script for peer panes.
// executeJavaScript never triggers before-input-event, so no feedback loop is possible.
function buildDispatchScript(input) {
  const init = JSON.stringify({
    key: input.key,
    code: input.code,
    ctrlKey: !!input.control,
    metaKey: !!input.meta,
    shiftKey: !!input.shift,
    altKey: !!input.alt,
    bubbles: true,
    cancelable: true,
  });
  return `(document.activeElement||document.body).dispatchEvent(new KeyboardEvent('keydown',${init}))`;
}

function buildSyncScript(input) {
  if (input.type !== "keyDown" && input.type !== "rawKeyDown") return null;
  if (input.control || input.meta) {
    switch (input.key.toLowerCase()) {
      case "a":
        return `document.execCommand('selectAll')`;
      case "z":
        return input.shift
          ? `document.execCommand('redo')`
          : `document.execCommand('undo')`;
      case "y":
        return `document.execCommand('redo')`;
    }
    // Any other ctrl/meta combo (e.g. Ctrl+Enter, Ctrl+K): dispatch as KeyboardEvent
    return buildDispatchScript(input);
  }
  if (input.key.length === 1) {
    return `document.execCommand('insertText',false,${JSON.stringify(input.key)})`;
  }
  switch (input.key) {
    case "Backspace":
      return `document.execCommand('delete')`;
    case "Delete":
      return `document.execCommand('forwardDelete')`;
    case "Enter":
      return `(function(){var el=document.activeElement||document.body;el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,cancelable:true}));var f=el.closest&&el.closest('form');if(f){var ev=new Event('submit',{bubbles:true,cancelable:true});f.dispatchEvent(ev);if(!ev.defaultPrevented)f.submit();}})()`;
    case "Tab":
      return `document.execCommand('insertText',false,'\\t')`;
  }
  return null;
}

const DEFAULT_APPS = [];

function getConfigPath() {
  return path.join(app.getPath("userData"), "apps.json");
}

function loadConfig() {
  const cfgPath = getConfigPath();
  if (!fs.existsSync(cfgPath)) {
    fs.writeFileSync(cfgPath, JSON.stringify(DEFAULT_APPS, null, 2));
    return { tabs: DEFAULT_APPS };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
    // Legacy: top-level array is the tab list. New: object with tabs + doh.
    if (Array.isArray(raw)) return { tabs: raw };
    return { tabs: raw.tabs || [], doh: raw.doh };
  } catch (e) {
    console.error("Invalid apps.json, using defaults:", e.message);
    return { tabs: DEFAULT_APPS };
  }
}

function loadApps() {
  return loadConfig().tabs;
}

function applyDoh(doh) {
  if (!doh) return;
  const norm = typeof doh === "string"
    ? { mode: "secure", servers: [doh] }
    : { mode: doh.mode || "secure", servers: [].concat(doh.servers || doh.server || []) };
  if (!norm.servers.length) {
    console.warn("[doh] no servers configured; ignoring");
    return;
  }
  app.configureHostResolver({
    enableBuiltInResolver: true,
    secureDnsMode: norm.mode,
    secureDnsServers: norm.servers,
  });
}

// Respond to renderer asking for apps
ipcMain.handle("get-apps", () => {
  return loadApps();
});

// host:port -> { username, password } — used by app.on('login') to answer
// proxy auth challenges for SOCKS5/HTTP proxies whose credentials came from the URL.
const proxyAuth = new Map();

function parseProxy(proxy) {
  try {
    const u = new URL(proxy);
    return {
      proxyRules: `${u.protocol}//${u.host}`,
      host: u.hostname,
      port: u.port,
      username: decodeURIComponent(u.username || ""),
      password: decodeURIComponent(u.password || ""),
    };
  } catch {
    return null;
  }
}

async function configureProxies(apps) {
  // Walk panes once, resolving partition -> proxy. Conflicts within a partition
  // can't be honored (proxy is per-session); first wins, with a warning.
  const partitionProxy = new Map();
  for (const tab of apps) {
    for (const pane of tab.panes || []) {
      if (!pane.proxy) continue;
      if (!pane.partition) {
        console.warn(`[proxy] pane "${pane.url}" needs a "partition" to use a proxy; ignoring`);
        continue;
      }
      const prev = partitionProxy.get(pane.partition);
      if (prev && prev !== pane.proxy) {
        console.warn(`[proxy] partition "${pane.partition}" has conflicting proxies; keeping ${prev}`);
        continue;
      }
      partitionProxy.set(pane.partition, pane.proxy);
    }
  }
  for (const [partition, proxy] of partitionProxy) {
    const parsed = parseProxy(proxy);
    if (!parsed) {
      console.error(`[proxy] invalid proxy URL for "${partition}": ${proxy}`);
      continue;
    }
    if (parsed.username) {
      proxyAuth.set(`${parsed.host}:${parsed.port}`, {
        username: parsed.username,
        password: parsed.password,
      });
    }
    const sess = session.fromPartition(partition);
    try {
      await sess.setProxy({ proxyRules: parsed.proxyRules, proxyBypassRules: "<local>" });
    } catch (e) {
      console.error(`[proxy] setProxy failed for "${partition}":`, e.message);
    }
  }
}

app.on("login", (event, _wc, _req, authInfo, callback) => {
  if (!authInfo.isProxy) return;
  const creds = proxyAuth.get(`${authInfo.host}:${authInfo.port}`);
  if (!creds) return;
  event.preventDefault();
  callback(creds.username, creds.password);
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
  wcIds.forEach((id) => {
    if (syncGroups.has(id)) {
      const peers = syncGroups.get(id);
      peers.forEach((peerId) => {
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
    wcIds.forEach((id) => {
      syncGroups.set(id, new Set(wcIds.filter((p) => p !== id)));
    });
  }
});

// Intercept all webview navigations at the main process level
app.on("web-contents-created", (_, contents) => {
  // Only apply to webviews, not the main window
  if (contents.getType() !== "webview") return;

  // Intercept Ctrl+F so the webview doesn't swallow it
  contents.on("before-input-event", (e, input) => {
    if (
      (input.control || input.meta) &&
      input.key.toLowerCase() === "f" &&
      (input.type === "keyDown" || input.type === "rawKeyDown")
    ) {
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
    peers.forEach((peerId) => {
      const peer = webContents.fromId(peerId);
      if (peer && !peer.isDestroyed())
        peer.executeJavaScript(script).catch(() => { });
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

const CHROME_VERSION = "146";
const CHROME_UA =
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VERSION}.0.0.0 Safari/537.36`;
const SEC_CH_UA = `"Chromium";v="${CHROME_VERSION}", "Not-A.Brand";v="24", "Google Chrome";v="${CHROME_VERSION}"`;
const WEBVIEW_PRELOAD = path.join(__dirname, "renderer", "webview-preload.js");

// Electron auto-grants every permission by default — switch to deny-by-default.
// Allowlist covers things normal apps need (camera/mic for meets, fullscreen, etc.).
const ALLOWED_PERMISSIONS = new Set([
  "media",
  "display-capture",
  "fullscreen",
  "pointerLock",
  "clipboard-sanitized-write",
]);

function hardenSession(sess) {
  sess.setUserAgent(CHROME_UA, "en-US,en");
  const preloads = new Set(sess.getPreloads());
  preloads.add(WEBVIEW_PRELOAD);
  sess.setPreloads([...preloads]);
  sess.webRequest.onBeforeSendHeaders((details, callback) => {
    const h = details.requestHeaders;
    if (details.url.startsWith("https://")) {
      h["Sec-Ch-Ua"] = SEC_CH_UA;
      h["Sec-Ch-Ua-Mobile"] = "?0";
      h["Sec-Ch-Ua-Platform"] = '"Windows"';
    } else {
      delete h["Sec-Ch-Ua"];
      delete h["Sec-Ch-Ua-Mobile"];
      delete h["Sec-Ch-Ua-Platform"];
    }
    // Pin Accept-Language so the OS/Chromium locale can never leak through.
    h["Accept-Language"] = "en-US,en;q=0.9";
    h["Accept-Encoding"] = "gzip, deflate";
    delete h["Upgrade-Insecure-Requests"];
    delete h["Available-Dictionary"];
    delete h["Sec-Available-Dictionary"];
    delete h["Dictionary-Id"];
    // Trim Referer to origin only — stricter than Chrome's default
    // strict-origin-when-cross-origin (drops same-origin path leaks too).
    if (h["Referer"]) {
      try {
        h["Referer"] = new URL(h["Referer"]).origin + "/";
      } catch {
        delete h["Referer"];
      }
    }
    callback({ requestHeaders: h });
  });
  sess.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission));
  });
  sess.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));
}

app.on("session-created", hardenSession);

app.whenReady().then(async () => {
  const cfg = loadConfig();
  hardenSession(session.defaultSession);
  applyDoh(cfg.doh);
  await configureProxies(cfg.tabs);
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
