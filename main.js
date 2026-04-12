const { app, BrowserWindow, ipcMain, shell, webContents } = require("electron");
app.commandLine.appendSwitch("enable-features", "WebviewTag");
const path = require("path");
const fs = require("fs");

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

// Intercept all webview navigations at the main process level
app.on("web-contents-created", (_, contents) => {
  // Only apply to webviews, not the main window
  if (contents.getType() !== "webview") return;

  // Intercept Ctrl+F so the webview doesn't swallow it
  contents.on("before-input-event", (e, input) => {
    if ((input.control || input.meta) && input.key.toLowerCase() === "f" && input.type === "keyDown") {
      e.preventDefault();
      const win = BrowserWindow.getAllWindows()[0];
      if (win) win.webContents.send("open-find-bar");
    }
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
