import { contextBridge, ipcRenderer } from "electron";
import type { Bridge } from "./bridge.js";

const bootstrap = Object.freeze(ipcRenderer.sendSync("pesuite:bootstrap"));
const bridge: Bridge = {
  bootstrap,
  health: () => ipcRenderer.invoke("pesuite:daemon", bootstrap.nonce, "health"),
  read: () => ipcRenderer.invoke("pesuite:daemon", bootstrap.nonce, "read"),
  write: (value) => ipcRenderer.invoke("pesuite:daemon", bootstrap.nonce, "write", value),
};
contextBridge.exposeInMainWorld("pesuite", Object.freeze(bridge));
