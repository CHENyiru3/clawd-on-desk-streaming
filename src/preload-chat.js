const { contextBridge, ipcRenderer } = require("electron");

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
});
