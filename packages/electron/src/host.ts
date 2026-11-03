import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { type Receipt, Session, type SessionOptions } from "@perishcode/runtime";
import { type Options as UpdateOptions, watch } from "@perishcode/update";
import { app, BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent, ipcMain, protocol } from "electron";
import { asset } from "./assets.js";
import { type AutomationReceipt, observeAutomation, prepareAutomation } from "./automation.js";
import { renderer as rendererAdapter } from "./renderer.js";

export interface HostOptions extends Omit<SessionOptions, "executable"> {
  preload: string;
  probe?: boolean;
  automation?: boolean;
  receipt?: string;
  updates?: Omit<UpdateOptions, "activate"> & { activate?: boolean };
  /** Caller-owned debugging contract; manager credentials are never sent to the renderer. */
  inspect?: (
    session: Session,
    receipt: HostReceipt,
    quit: () => void,
    snapshot: () => Promise<HostReceipt>,
  ) => Promise<void>;
}

export interface HostReceipt extends Receipt {
  automation: AutomationReceipt;
}

export async function startElectron(options: HostOptions): Promise<void> {
  const automated = !!(options.probe || options.automation);
  prepareAutomation(automated);
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
      frame.url === session?.webURL()
    );
  };
  try {
    await app.whenReady();
    session = await Session.open({ ...options, root, executable: process.execPath });
    const active = session;
    const payload = await active.activate();
    await active.start();
    protocol.handle(options.manifest.identity.scheme, (request) => {
      const url = new URL(request.url),
        prefix = new URL(active.webURL()).pathname;
      if (!url.pathname.startsWith(prefix)) return new Response("not found", { status: 404 });
      url.pathname = `/${url.pathname.slice(prefix.length)}`;
      return asset(active.mount.web, new Request(url, request));
    });
    ipcMain.on("pesuite:bootstrap", (event) => {
      event.returnValue = allowed(event) ? active.browser() : null;
    });
    ipcMain.handle("pesuite:daemon", (event, nonce: unknown, operation: unknown, value: unknown) => {
      if (!allowed(event) || nonce !== active.documentNonce()) throw new Error("untrusted or expired renderer");
      if (operation !== "health" && operation !== "read" && operation !== "write") throw new Error("unknown operation");
      if (operation === "write" && Buffer.byteLength(JSON.stringify(value) ?? "") > 65536)
        throw new Error("payload too large");
      return active.request(operation, value);
    });
    window = new BrowserWindow({
      title: payload.title,
      show: !automated,
      focusable: !automated,
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        preload: resolve(options.preload),
      },
    });
    const automation = observeAutomation(window, automated);
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    const screen = rendererAdapter(window, active);
    const renderer = await screen.reload();
    const receipt: HostReceipt = { ...(await active.confirm(payload, renderer)), automation: automation() };
    if (options.updates)
      await watch(active, {
        ...options.updates,
        activate: options.updates.activate ? (release) => active.applyLeaf(release, screen) : undefined,
      });
    await options.inspect?.(
      active,
      receipt,
      () => app.quit(),
      async () => ({ ...(await active.snapshot()), automation: automation() }),
    );
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
