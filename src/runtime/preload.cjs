const { contextBridge, ipcRenderer } = require("electron");

if (process.argv.includes("--vraxis-directory-picker")) {
  contextBridge.exposeInMainWorld("vraxisDesktop", Object.freeze({
    chooseDirectory: () => ipcRenderer.invoke("vraxis-desktop:choose-directory"),
  }));
}
