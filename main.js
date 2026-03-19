const { app, BrowserWindow, ipcMain } = require("electron");
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
ipcMain.handle("get-apps", () => loadApps());

// Let renderer open config file in default editor
ipcMain.handle("open-config", () => {
  const { shell } = require("electron");
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
