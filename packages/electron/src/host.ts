import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Session, type SessionOptions } from "@perishcode/runtime";
import { app, BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent, ipcMain, protocol } from "electron";
import { asset } from "./assets.js";

export interface HostOptions extends Omit<SessionOptions, "executable"> {
  preload: string;
  probe?: boolean;
  receipt?: string;
}

export async function startElectron(options: HostOptions): Promise<void> {
  const root = resolve(options.root);
  app.setName(options.manifest.identity.name);
  app.setPath("userData", root);
  if (!app.requestSingleInstanceLock()) {
    app.exit(1);
    return;
  }
  protocol.registerSchemesAsPrivileged([
    {
      scheme: options.manifest.identity.scheme,
      privileges: { secure: true, standard: true, supportFetchAPI: true, corsEnabled: true },
    },
  ]);
  if (options.probe) app.disableHardwareAcceleration();
  let session: Session | undefined;
  let closing = false;
  let window: BrowserWindow | undefined;
  let completed = false;
  app.on("before-quit", (event) => {
    if (closing) return;
    event.preventDefault();
    closing = true;
    void (session?.close() ?? Promise.resolve({ status: "stopped", survivors: [] }))
      .then(async (stop) => {
        if (options.receipt) {
          await mkdir(dirname(options.receipt), { recursive: true });
          await writeFile(`${options.receipt}.stop.json`, JSON.stringify(stop));
        }
        app.exit(completed ? 0 : 1);
      })
      .catch((fault: Error) => {
        process.stderr.write(`${fault.stack}\n`);
        app.exit(1);
      });
  });
  const allowed = (event: IpcMainEvent | IpcMainInvokeEvent): boolean => {
    const frame = event.senderFrame;
    return (
      !!window &&
      event.sender === window.webContents &&
      frame === window.webContents.mainFrame &&
      frame.url === `${options.manifest.identity.origin}/`
    );
  };
  try {
    await app.whenReady();
    session = await Session.open({ ...options, root, executable: process.execPath });
    const active = session;
    const payload = await active.activate();
    await active.start();
    protocol.handle(options.manifest.identity.scheme, (request) => asset(active.mount.web, request));
    ipcMain.on("pesuite:bootstrap", (event) => {
      event.returnValue = allowed(event)
        ? {
            generation: active.mount.target,
            nonce: active.nonce,
            version: active.manifest.identity.version,
          }
        : null;
    });
    ipcMain.handle("pesuite:daemon", (event, operation: unknown, value: unknown) => {
      if (!allowed(event)) throw new Error("untrusted renderer");
      if (operation !== "health" && operation !== "read" && operation !== "write") throw new Error("unknown operation");
      if (operation === "write" && Buffer.byteLength(JSON.stringify(value) ?? "") > 65536)
        throw new Error("payload too large");
      return active.request(operation, value);
    });
    window = new BrowserWindow({
      title: payload.title,
      show: !options.probe,
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        preload: resolve(options.preload),
      },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    await window.loadURL(options.manifest.identity.origin);
    const deadline = Date.now() + 10000;
    let renderer = "";
    while (Date.now() < deadline) {
      const result = await window.webContents.executeJavaScript(`({
        status: document.querySelector('output')?.textContent,
        witness: document.querySelector('output')?.getAttribute('data-witness'),
        generation: globalThis.pesuite?.bootstrap.generation,
        nonce: globalThis.pesuite?.bootstrap.nonce
      })`);
      if (
        result.status === "ready" &&
        result.generation === active.mount.target &&
        result.nonce === active.nonce &&
        result.witness
      ) {
        renderer = result.witness;
        break;
      }
      await new Promise((done) => setTimeout(done, 50));
    }
    if (!renderer) throw new Error("renderer readiness timeout");
    const receipt = await active.confirm(payload, renderer);
    if (options.receipt) {
      await mkdir(dirname(options.receipt), { recursive: true });
      await writeFile(options.receipt, JSON.stringify(receipt));
    }
    completed = true;
    if (options.probe) app.quit();
    else app.on("window-all-closed", () => app.quit());
  } catch (fault) {
    process.stderr.write(`${(fault as Error).stack}\n`);
    app.quit();
  }
}
