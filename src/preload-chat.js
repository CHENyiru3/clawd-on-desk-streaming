const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("chatAPI", {
  // Send a message
  send: (text) => ipcRenderer.send("chat-send", { text }),
  // Open/close from code
  open: () => ipcRenderer.send("chat-open"),
  close: () => ipcRenderer.send("chat-close"),
  clear: () => ipcRenderer.send("chat-clear"),
  // Receive streaming tokens
  onToken: (cb) => ipcRenderer.on("chat-token", (_, data) => cb(data)),
  // Receive error
  onError: (cb) => ipcRenderer.on("chat-error", (_, msg) => cb(msg)),
  // Receive full history on load
  onHistory: (cb) => ipcRenderer.on("chat-history", (_, msgs) => cb(msgs)),
  // Receive busy/idle indicator
  onBusy: (cb) => ipcRenderer.on("chat-busy", (_, { busy }) => cb(busy)),
  // Receive DND state
  onDnd: (cb) => ipcRenderer.on("chat-dnd", (_, { active }) => cb(active)),
  onStatus: (cb) => ipcRenderer.on("chat-status", (_, { status }) => cb(status)),
  // Receive language change
  onLangChange: (cb) => ipcRenderer.on("chat-lang-change", (_, { lang }) => cb(lang)),
  onPermissionRequest: (cb) => ipcRenderer.on("chat-permission-request", (_, data) => cb(data)),
  onPermissionResolved: (cb) => ipcRenderer.on("chat-permission-resolved", (_, data) => cb(data)),
  decidePermission: (payload) => ipcRenderer.send("chat-permission-decide", payload),
  // Drag-and-drop: receive file paths from the main process (paths are extracted via
  // webUtils.getPathForFile in this preload; this is just for future main-process routing needs)
  onDroppedPaths: (cb) => ipcRenderer.on("chat-dropped-paths", (_, { paths }) => cb(paths)),
  // Extract the native file system path for a dropped File object via Electron webUtils.
  // Falls back to "" when the path cannot be resolved.
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file) || "";
    } catch (_) {
      return "";
    }
  },
});
