import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { channel, digest, namespace } from "@perish/protocol";
import { emit, resolve } from "@perish/release";
import { Client, serve, type Lease } from "@perish/sidecar";
import { describe, expect, it } from "vitest";

import { asset } from "@";

const electron = createRequire(import.meta.url)("electron") as string;

function output(child: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => reject(new Error(`carrier timeout: ${stderr}`)), 60000);
    child.stdout?.on("data", (chunk: Buffer) => stdout += chunk.toString());
    child.stderr?.on("data", (chunk: Buffer) => stderr += chunk.toString());
    child.once("error", reject);
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`carrier exited ${code}: ${stderr}`));
    });
  });
}

describe("carrier", () => {
  it("serves only files inside the injected web root", async () => {
    const root = await mkdtemp(join(tmpdir(), "perish-carrier-"));
    await writeFile(join(root, "index.html"), "ready");

    expect(await (await asset(root, new Request("electronsuite://carrier/"))).text()).toBe("ready");
    expect((await asset(root, new Request("electronsuite://other/"))).status).toBe(404);
    expect((await asset(root, new Request("electronsuite://carrier/%2e%2e%2fsecret"))).status).toBe(403);
  });

  it("emits a runtime identity fixture without changing app version", async () => {
    const root = await mkdtemp(join(tmpdir(), "perish-carrier-"));
    const manifest = resolve({}, { channel: channel("beta"), version: "2.0.0-beta.1" });
    const path = await emit(root, manifest);

    expect(path).toBe(join(root, "release.json"));
    expect(manifest.identity.origin).toBe("electronsuite-beta://carrier");
  });

  it.runIf(process.platform === "darwin" && process.env.PERISH_GUI === "1")(
    "runs Web to Daemon in real Chromium",
    async () => {
    const root = await mkdtemp(join(tmpdir(), "perish-carrier-"));
    const endpoint = join(root, "sidecar.sock");
    const service = await serve(endpoint);
    const client = new Client(endpoint, service.authority);
    const scope = namespace("main");
    const owner = "attempt";
    const token = randomBytes(32).toString("base64url");
    const data = await client.grant(scope, { kind: "data", name: "daemon", scope: "namespace" });
    const carrier = await client.grant(scope, { kind: "data", name: "carrier", scope: "namespace" });
    const socket = await client.grant(scope, { kind: "socket", name: "daemon", owner, scope: "attempt" });
    const port = await client.grant(scope, { kind: "port", name: "daemon", owner, scope: "attempt" });
    const manifest = resolve({}, { channel: channel("stable"), version: "1.0.0" });
    const release = await emit(root, manifest);
    const daemonenv = {
      PERISH_DATA: data.value,
      PERISH_ORIGIN: manifest.identity.origin,
      PERISH_SOCKET: socket.value,
      PERISH_TOKEN: token,
    };
    const here = dirname(fileURLToPath(import.meta.url));
    const webroot = dirname(fileURLToPath(import.meta.resolve("@perish/web")));
    const carrierenv = {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
      PERISH_DAEMON: port.value,
      PERISH_DATA: carrier.value,
      PERISH_PROBE: "1",
      PERISH_RELEASE: release,
      PERISH_TOKEN: token,
      PERISH_WEB: webroot,
    };
    let lease: Lease | undefined;
    let child: ChildProcess | undefined;

    try {
      const daemonroot = dirname(fileURLToPath(import.meta.resolve("@perish/daemon")));
      lease = await client.start({
        args: [join(daemonroot, "main.mjs")],
        channel: channel("stable"),
        command: process.execPath,
        env: daemonenv,
        generation: digest("carrierdaemon"),
        namespace: scope,
        ready: "ready",
        slot: "daemon",
      });
      await client.forward(scope, port.lease, socket.lease);
      const spawned = spawn(electron, [join(here, "../dist/main.mjs")], {
        env: carrierenv,
        stdio: ["ignore", "pipe", "pipe"],
      });
      child = spawned;
      expect(await output(spawned)).toContain('"status":"ready"');
    } finally {
      if (child?.exitCode === null) child.kill("SIGTERM");
      if (lease) await client.release(lease);
      await service.close();
      await rm(root, { force: true, recursive: true });
    }
    },
  );
});
