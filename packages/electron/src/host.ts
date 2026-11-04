import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { protocolIdentity } from "@perishcode/release";
import { type Receipt, Session, type SessionOptions } from "@perishcode/runtime";
import { type Options as UpdateOptions, watch } from "@perishcode/update";
import { app, BrowserWindow, ipcMain, protocol } from "electron";
import { type AutomationReceipt, observeAutomation, prepareAutomation } from "./automation.js";
import { renderer as rendererAdapter } from "./renderer.js";
import { Links, loading, routes } from "./routing.js";

export interface HostOptions extends Omit<SessionOptions, "executable"> {
  preload: string;
  probe?: boolean;
  automation?: boolean;
  receipt?: string;
  updates?: Omit<UpdateOptions, "activate" | "layer"> & { activate?: boolean; capsule?: boolean };
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
  adapter: {
    loading: string;
    title: string;
    internal: string;
    external: string;
    ipcCalls: number;
    protocolCalls: number;
    links: ReturnType<Links["snapshot"]>;
  };
}

export async function startElectron(options: HostOptions): Promise<void> {
  const automated = !!(options.probe || options.automation);
  prepareAutomation(automated);
  const root = resolve(options.root);
  const identity = protocolIdentity(options.manifest);
  const links = new Links(app, identity.external);
  app.setName(options.manifest.identity.name);
  app.setPath("userData", root);
  if (!app.requestSingleInstanceLock()) {
    app.exit(1);
    return;
  }
  protocol.registerSchemesAsPrivileged([
    {
      scheme: identity.internal,
      privileges: { secure: true, standard: true, supportFetchAPI: true, corsEnabled: true },
    },
  ]);
  let session: Session | undefined;
  let closing = false;
  let window: BrowserWindow | undefined;
  let completed = false;
  let capsuleObserver: Awaited<ReturnType<typeof watch>> | undefined;
  let registered: ReturnType<typeof routes> | undefined;
  let screen: ReturnType<typeof rendererAdapter> | undefined;
  const adapter = () => ({
    loading: screen?.snapshot().loading ?? payloadLoading,
    title: window?.getTitle() ?? options.manifest.identity.name,
    internal: identity.internal,
    external: identity.external,
    ...(registered?.snapshot() ?? { ipcCalls: 0, protocolCalls: 0 }),
    links: links.snapshot(),
  });
  let payloadLoading = "";
  app.on("before-quit", (event) => {
    if (closing) return;
    event.preventDefault();
    closing = true;
    void (async () => {
      await capsuleObserver?.close();
      return session?.close() ?? { status: "stopped", survivors: [] };
    })()
      .then(async (stop) => {
        registered?.close();
        await links.close();
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
  try {
    await app.whenReady();
    session = await Session.open({ ...options, root, executable: process.execPath });
    const active = session;
    const payload = await active.activate({
      updates: options.updates
        ? async () => {
            if (!screen) throw new Error("renderer not ready for updates");
            return watch(active, {
              ...options.updates!,
              layer: "leaf",
              activate: options.updates!.activate ? (release) => active.applyLeaf(release, screen!) : undefined,
            });
          }
        : undefined,
    });
    payloadLoading = payload.loading;
    window = new BrowserWindow({
      title: payload.window.title,
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
    window.on("page-title-updated", (event) => event.preventDefault());
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    registered = routes(ipcMain, protocol, window, active);
    await window.loadURL(loading(payload.loading));
    payloadLoading = await window.webContents.executeJavaScript("document.querySelector('output')?.textContent");
    if (payloadLoading !== payload.loading) throw new Error("loading page evidence mismatch");
    await active.start();
    screen = rendererAdapter(window, active);
    const renderer = await screen.reload();
    const receipt: HostReceipt = {
      ...(await active.confirm(payload, renderer)),
      automation: automation(),
      adapter: adapter(),
    };
    if (options.updates?.capsule)
      capsuleObserver = await watch(active, {
        ...options.updates,
        layer: "capsule",
        activate: (release) => active.applyCapsule(release, screen!),
      });
    links.bind((url) => active.call("open", url));
    await options.inspect?.(
      active,
      receipt,
      () => app.quit(),
      async () => ({ ...(await active.snapshot()), automation: automation(), adapter: adapter() }),
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
