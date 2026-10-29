import { contextBridge, ipcRenderer } from "electron";
import type { Bridge } from "./bridge.js";

const bridge: Bridge = {
  bootstrap: Object.freeze(ipcRenderer.sendSync("pesuite:bootstrap")),
  health: () => ipcRenderer.invoke("pesuite:daemon", "health"),
  read: () => ipcRenderer.invoke("pesuite:daemon", "read"),
  write: (value) => ipcRenderer.invoke("pesuite:daemon", "write", value),
};
contextBridge.exposeInMainWorld("pesuite", Object.freeze(bridge));
