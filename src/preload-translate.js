const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("translateAPI", {
  onShow: (cb) => ipcRenderer.on("translate-show", (_, data) => cb(data)),
  reportHeight: (h) => ipcRenderer.send("translate-height", h),
  close: () => ipcRenderer.send("translate-close"),
});
