import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow, ipcMain, protocol } from "electron";

import { asset } from "./assets.js";
import { runtime } from "./runtime.js";

const options = runtime();
const identity = options.manifest.identity;
const mark = (state: string): void => {
  if (options.probe) process.stderr.write(`carrier:${state}\n`);
};

mark("loaded");
protocol.registerSchemesAsPrivileged([{
  privileges: {
    corsEnabled: true,
    secure: true,
    standard: true,
    supportFetchAPI: true,
  },
  scheme: identity.scheme,
}]);
if (options.probe) app.disableHardwareAcceleration();
app.setName(identity.name);
app.setPath("userData", options.data);
app.on("will-finish-launching", () => mark("launching"));

ipcMain.on("bootstrap", (event) => {
  event.returnValue = { daemon: options.daemon, token: options.token };
});

async function probe(window: BrowserWindow): Promise<void> {
  const limit = Date.now() + 10000;
  let last: unknown;
  while (Date.now() < limit) {
    const value = await window.webContents.executeJavaScript("document.querySelector('output')?.textContent");
    if (value === "ready") {
      process.stdout.write(`${JSON.stringify({ origin: identity.origin, status: "ready" })}\n`);
      app.quit();
      return;
    }
    last = value;
    await new Promise((done) => setTimeout(done, 50));
  }
  throw new Error(`renderer readiness timeout: ${String(last)}`);
}

await app.whenReady();
mark("ready");
protocol.handle(identity.scheme, (request) => asset(options.web, request));
const here = fileURLToPath(new URL(".", import.meta.url));
const window = new BrowserWindow({
  show: !options.probe,
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
    preload: join(here, "preload.cjs"),
    sandbox: true,
  },
});
await window.loadURL(identity.origin);
mark("loadedweb");
if (options.probe) {
  try {
    await probe(window);
  } catch (fault) {
    process.stderr.write(`${(fault as Error).message}\n`);
    app.exit(1);
  }
}
app.on("window-all-closed", () => app.quit());
