import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { type Catalog, ShellRequired } from "@perishcode/distribution";
import { app, BrowserWindow } from "electron";
import { observeAutomation } from "../automation.js";

function encodeText(value: string) {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
/** Stable native-owned UI. No product preload, IPC, protocols or adapter code. */
export class NativeGate {
  private window?: BrowserWindow;
  private observe?: ReturnType<typeof observeAutomation>;
  private retrying = false;
  private retries = 0;
  constructor(
    private catalog: Catalog,
    private automated: boolean,
    private receipt?: string,
  ) {}
  async show(error: unknown, facts: Record<string, unknown> = {}) {
    if (!this.window) {
      this.window = new BrowserWindow({
        title: "Application update required",
        show: !this.automated,
        focusable: !this.automated,
        webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
      });
      this.observe = observeAutomation(this.window, this.automated);
      this.window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      this.window.webContents.on("will-navigate", (event) => {
        event.preventDefault();
        if (event.url === "pesuite-update://quit") app.quit();
        if (event.url === "pesuite-update://retry" && !this.retrying) void this.retry();
      });
    }
    const minimum = error instanceof ShellRequired ? error.metadata.minShellVersion : undefined;
    const text = minimum
      ? `Update required: shell ${this.catalog.options.shellVersion}, minimum ${minimum}`
      : `Update verification failed: ${String(error)}`;
    const html = `<html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; navigate-to pesuite-update:"></head><body><h1>Application update required</h1><output>${encodeText(text)}</output><p><a href="pesuite-update://retry">Retry</a> <a href="pesuite-update://quit">Quit</a></p></body></html>`;
    await this.window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const actual = await this.window.webContents.executeJavaScript("document.querySelector('output')?.textContent");
    if (actual !== text) throw new Error("native blocking document evidence missing");
    if (this.receipt) {
      await mkdir(dirname(this.receipt), { recursive: true });
      await writeFile(
        `${this.receipt}.gate.json`,
        JSON.stringify({
          ...facts,
          result: "blocked",
          pid: process.pid,
          installed: this.catalog.options.shellVersion,
          minimum,
          error: String(error),
          witness: actual,
          automation: this.observe!(),
          productPreload: false,
          retries: this.retries,
          installer: "not-yet-implemented",
        }),
      );
    }
  }
  private async retry() {
    this.retrying = true;
    this.retries++;
    try {
      await this.catalog.head(this.catalog.options.channel);
      app.relaunch();
      app.quit();
    } catch (error) {
      await this.show(error);
    } finally {
      this.retrying = false;
    }
  }
}
