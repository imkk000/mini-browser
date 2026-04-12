const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  getApps: () => ipcRenderer.invoke("get-apps"),
  openConfig: () => ipcRenderer.invoke("open-config"),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  onOpenFind: (cb) => ipcRenderer.on("open-find-bar", cb),
  webviewFind: (wcId, text, options) => ipcRenderer.invoke("webview-find", wcId, text, options),
  webviewStopFind: (wcId) => ipcRenderer.invoke("webview-stop-find", wcId),
  onFoundInPage: (cb) => ipcRenderer.on("found-in-page-result", (_, wcId, result) => cb(wcId, result)),
});
