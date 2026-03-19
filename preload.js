const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  getApps: () => ipcRenderer.invoke("get-apps"),
  openConfig: () => ipcRenderer.invoke("open-config"),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
});
