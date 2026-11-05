import { contextBridge, ipcRenderer } from "electron";

const value: unknown = ipcRenderer.sendSync("bootstrap");
contextBridge.exposeInMainWorld("perish", Object.freeze(value));
