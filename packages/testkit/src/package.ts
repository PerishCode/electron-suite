import { spawn, type ChildProcess } from "node:child_process";
import { cp } from "node:fs/promises";
import { basename, join } from "node:path";

import { type Mount } from "@perish/capsule";
import { inspect, pack } from "@perish/pack";
import { channel, digest, namespace, type Digest } from "@perish/protocol";
import { distinct, resolve, type Manifest } from "@perish/release";
import { type Client, type Lease } from "@perish/sidecar";

export interface Installed {
  artifacts: Digest[];
  built: string[];
  pids: number[];
  restored: string[];
  survivors: number[];
  transitions: string[];
}

export interface Sources {
  carrier: string;
  daemon: string;
  web: string;
}

export interface Selections {
  beta: Mount;
  stable: Mount;
}

interface Launch {
  pid: number;
  survivors: number[];
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

async function launch(client: Client, app: string, manifest: Manifest, mount: Mount): Promise<Launch> {
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
  let pid = 0;
  let status = "stopped";
  let survivors: number[] = [];

  try {
    lease = await client.start({
      args: [join(mount.daemon, "main.mjs")],
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
        PERISH_WEB: mount.web,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const result = await output(child);
    if (result.origin !== manifest.identity.origin || result.version !== manifest.identity.version) {
      throw new Error("installed identity mismatch");
    }
    pid = lease.pid;
  } finally {
    if (child?.exitCode === null) child.kill("SIGTERM");
    try {
      if (lease) {
        const released = await client.release(lease);
        survivors = released.survivors;
        status = released.status;
      }
    } finally {
      await client.retire(capability);
    }
    if (status !== "stopped") throw new Error(`daemon retirement is ${status}`);
  }
  return { pid, survivors };
}

export async function installed(
  client: Client,
  temporary: string,
  sources: Sources,
  selections: Selections,
): Promise<Installed> {
  const manifests = [
    resolve({}, { channel: channel("stable"), version: "1.0.0" }),
    resolve({}, { channel: channel("beta"), version: "1.0.0-beta.1" }),
  ];
  distinct(manifests);
  const install = join(temporary, "install");
  const built: string[] = [];
  const pids: number[] = [];
  const survivors: number[] = [];

  for (const manifest of manifests) {
    const mount = manifest.channel === "stable" ? selections.stable : selections.beta;
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
    const launched = await launch(client, app, manifest, mount);
    pids.push(launched.pid);
    survivors.push(...launched.survivors);
  }
  return {
    artifacts: [selections.stable.target, selections.beta.target],
    built,
    pids,
    restored: ["capsule", "daemon", "web", "model"],
    survivors,
    transitions: ["select", "mount", "pack", "install", "launch", "ready"],
  };
}
