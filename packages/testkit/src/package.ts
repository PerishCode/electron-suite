import { spawn, type ChildProcess } from "node:child_process";
import { cp } from "node:fs/promises";
import { basename, join } from "node:path";

import { inspect, pack } from "@perish/pack";
import { channel, digest, namespace } from "@perish/protocol";
import { distinct, resolve, type Manifest } from "@perish/release";
import { type Client, type Lease } from "@perish/sidecar";

export interface Installed {
  built: string[];
  pids: number[];
  transitions: string[];
}

export interface Sources {
  carrier: string;
  daemon: string;
  web: string;
}

function output(child: ChildProcess): Promise<Record<string, unknown>> {
  return new Promise((done, reject) => {
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => reject(new Error(`installed carrier timeout:${stderr}`)), 30000);
    child.stdout?.on("data", (chunk: Buffer) => stdout += chunk.toString());
    child.stderr?.on("data", (chunk: Buffer) => stderr += chunk.toString());
    child.once("error", reject);
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`installed carrier exited ${code}:${stderr}`));
      else done(JSON.parse(stdout) as Record<string, unknown>);
    });
  });
}

async function launch(client: Client, app: string, manifest: Manifest): Promise<number> {
  const scope = namespace(`installed${manifest.channel}`);
  const owner = `installed${manifest.channel}`;
  const capability = await client.issue({ channel: manifest.channel, namespace: scope, owner, service: "daemon" });
  const data = await client.grant(scope, { kind: "data", name: "daemon", scope: "namespace" });
  const carrier = await client.grant(scope, { kind: "data", name: "carrier", scope: "namespace" });
  const socket = await client.grant(scope, { kind: "socket", name: "daemon", owner, scope: "attempt" });
  const port = await client.grant(scope, {
    kind: "port", name: "daemon", owner, scheme: "http", scope: "attempt",
  });
  const executable = join(app, "Contents", "MacOS", manifest.identity.scheme);
  const resources = join(app, "Contents", "Resources");
  let lease: Lease | undefined;
  let child: ChildProcess | undefined;

  try {
    lease = await client.start({
      args: [join(resources, "daemon", "main.mjs")],
      channel: manifest.channel,
      command: executable,
      env: {
        ELECTRON_RUN_AS_NODE: "1",
        PERISH_DATA: data.value,
        PERISH_ORIGIN: manifest.identity.origin,
        PERISH_SOCKET: socket.value,
        PERISH_TOKEN: capability.token,
      },
      generation: digest(`installed${manifest.channel}`),
      namespace: scope,
      ready: "ready",
      slot: "daemon",
    });
    await client.forward(scope, port.lease, socket.lease);
    child = spawn(executable, [], {
      env: {
        ...process.env,
        ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
        PERISH_DAEMON: port.value,
        PERISH_DATA: carrier.value,
        PERISH_PROBE: "1",
        PERISH_RELEASE: join(resources, "release.json"),
        PERISH_TOKEN: capability.token,
        PERISH_WEB: join(resources, "web"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const result = await output(child);
    if (result.origin !== manifest.identity.origin || result.version !== manifest.identity.version) {
      throw new Error("installed identity mismatch");
    }
    return lease.pid;
  } finally {
    if (child?.exitCode === null) child.kill("SIGTERM");
    if (lease) await client.release(lease);
    await client.retire(capability);
  }
}

export async function installed(
  client: Client,
  temporary: string,
  sources: Sources,
): Promise<Installed> {
  const manifests = [
    resolve({}, { channel: channel("stable"), version: "1.0.0" }),
    resolve({}, { channel: channel("beta"), version: "1.0.0-beta.1" }),
  ];
  distinct(manifests);
  const install = join(temporary, "install");
  const built: string[] = [];
  const pids: number[] = [];

  for (const manifest of manifests) {
    const result = await pack({
      ...sources,
      manifest,
      output: join(temporary, "pack", manifest.channel),
    });
    const app = join(install, basename(result.app));
    await cp(result.app, app, {
      preserveTimestamps: true,
      recursive: true,
      verbatimSymlinks: true,
    });
    const receipt = await inspect(app);
    if (receipt.appid !== manifest.identity.appid || receipt.version !== manifest.identity.version) {
      throw new Error("installed bundle identity mismatch");
    }
    built.push(basename(app));
    pids.push(await launch(client, app, manifest));
  }
  return { built, pids, transitions: ["pack", "install", "launch", "ready"] };
}
