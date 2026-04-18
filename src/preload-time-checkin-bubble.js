const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("timeCheckinBubbleAPI", {
  onShow: (cb) => ipcRenderer.on("time-checkin-bubble-show", (_, data) => cb(data)),
  onHide: (cb) => ipcRenderer.on("time-checkin-bubble-hide", () => cb()),
  dismiss: () => ipcRenderer.send("time-checkin-bubble-dismiss"),
  reportHeight: (height) => ipcRenderer.send("time-checkin-bubble-height", height),
});
