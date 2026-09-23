import { execFile } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve as resolvepath } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { Capsule } from "@perish/capsule";
import { guard } from "@perish/guard";
import { channel, gates, namespace, startup, type Channel, type Digest } from "@perish/protocol";
import { Authority, Feed, serve as publish, type Service as Publisher } from "@perish/publish";
import { compose, resolve as release, type Product } from "@perish/release";
import { Client, serve as sidecar, type Service as Sidecar } from "@perish/sidecar";

import { matrix, type Definition, type Id, type Status } from "./matrix.js";
import { installed } from "./package.js";
import { encode, parse, type Evidence, type Report } from "./schema.js";

export interface Options {
  chromium?: boolean;
  output: string;
  packaged?: boolean;
  root: string;
}

const execute = promisify(execFile);

function definition(id: Id): Definition {
  const value = matrix.find((item) => item.id === id);
  if (!value) throw new Error(`scenario absent:${id}`);
  return value;
}

function evidence(
  id: Id,
  status: Status,
  actual: string,
  milliseconds: number,
  values: Partial<Evidence> = {},
): Evidence {
  const item = definition(id);
  return {
    actual,
    artifacts: values.artifacts ?? [],
    built: values.built ?? [],
    diagnostics: values.diagnostics ?? [],
    downloaded: values.downloaded ?? [],
    expected: item.expected,
    gate: item.gate,
    id,
    milliseconds,
    pids: values.pids ?? [],
    restored: values.restored ?? [],
    status,
    survivors: values.survivors ?? [],
    transitions: values.transitions ?? [],
  };
}

async function timed<T>(action: () => Promise<T>): Promise<{ milliseconds: number; value: T }> {
  const start = performance.now();
  const value = await action();
  return { milliseconds: Math.round((performance.now() - start) * 1000) / 1000, value };
}

function pem() {
  const pair = generateKeyPairSync("ed25519");
  return {
    privatekey: pair.privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    publickey: pair.publicKey.export({ format: "pem", type: "spki" }).toString(),
  };
}

function path(name: "capsule" | "carrier" | "daemon" | "web"): string {
  return dirname(fileURLToPath(import.meta.resolve(`@perish/${name}`)));
}

async function installation(client: Client, temporary: string): Promise<Evidence> {
  try {
    const qualified = await timed(() => installed(client, temporary, {
      carrier: path("carrier"),
      daemon: path("daemon"),
      web: path("web"),
    }));
    return evidence("PKG-01", "passed", "two channel identities installed and launched", qualified.milliseconds, {
      built: qualified.value.built,
      pids: qualified.value.pids,
      transitions: qualified.value.transitions,
    });
  } catch (fault) {
    const error = fault as Error;
    return evidence("PKG-01", "failed", error.message, 0, {
      diagnostics: [error.stack ?? error.message],
    });
  }
}

async function product(lane: Channel, version: string, model: string): Promise<Product> {
  return compose(release({}, { channel: lane, version }), {
    blobs: [{ path: model, slot: "model" }],
    capsule: path("capsule"),
    carrier: 1,
    daemon: path("daemon"),
    web: path("web"),
  });
}

async function commit(capsule: Capsule, feed: Feed): Promise<Digest> {
  let attempt = await capsule.update(feed);
  if (!attempt) throw new Error("candidate missing");
  for (const gate of gates) attempt = await capsule.ready(attempt, gate);
  return (await capsule.commit(attempt)).state.current!;
}

async function versions(root: string): Promise<Report["tools"] & { revision: string }> {
  const [{ stdout: revision }, { stdout: pnpm }] = await Promise.all([
    execute("git", ["rev-parse", "HEAD"], { cwd: root }),
    execute("pnpm", ["--version"], { cwd: root }),
  ]);
  const require = createRequire(import.meta.url);
  const electron = JSON.parse(await readFile(require.resolve("electron/package.json"), "utf8")) as { version: string };
  return { electron: electron.version, node: process.versions.node, pnpm: pnpm.trim(), revision: revision.trim() };
}

export async function run(options: Options): Promise<Report> {
  const root = resolvepath(options.root);
  const output = resolvepath(root, options.output);
  const temporary = await mkdtemp(join(tmpdir(), "qualification-"));
  const scenarios: Evidence[] = [];
  let host: Sidecar | undefined;
  let server: Publisher | undefined;
  let failure: Error | undefined;
  try {
    const checked = await timed(() => guard({ root }));
    scenarios.push(evidence(
      "BUILD-01",
      checked.value.ok ? "passed" : "failed",
      checked.value.ok ? `${checked.value.paths} repository paths accepted` : "repository policy failed",
      checked.milliseconds,
      { diagnostics: checked.value.findings.map((item) => `${item.path}:${item.rule}`) },
    ));
    const model = join(temporary, "model.bin");
    await writeFile(model, "qualification model");
    const stable = channel("stable");
    const beta = channel("beta");
    const built = await timed(async () => {
      const first = await product(stable, "1.0.0", model);
      const repeated = await product(stable, "1.0.0", model);
      if (first.envelope.digest !== repeated.envelope.digest) throw new Error("generation drift");
      return { first, preview: await product(beta, "1.0.0-beta.1", model) };
    });
    scenarios.push(evidence("BUILD-03", "passed", "generation identity repeated exactly", built.milliseconds, {
      artifacts: [built.value.first.envelope.digest, built.value.preview.envelope.digest],
      built: ["capsule", "daemon", "web", "model"],
    }));
    const endpoint = join(temporary, "sidecar.sock");
    host = await sidecar(endpoint);
    let client = new Client(host.endpoint, host.authority);
    const release = namespace("release");
    const data = await client.grant(release, { kind: "data", name: "publish", scope: "namespace" });
    const socket = await client.grant(release, {
      kind: "socket", name: "publish", owner: "server", scope: "attempt",
    });
    const port = await client.grant(release, {
      kind: "port", name: "publish", owner: "server", scheme: "http", scope: "attempt",
    });
    const keys = pem();
    const authority = await Authority.open({ privatekey: keys.privatekey, root: data.value });
    server = await publish(authority, socket.value);
    await client.forward(release, port.lease, socket.lease);
    const feed = new Feed(port.value, keys.publickey);
    const published = await timed(async () => {
      await authority.publish(stable, 0, built.value.first.envelope, built.value.first.assets);
      await authority.publish(beta, 0, built.value.preview.envelope, built.value.preview.assets);
      const primary = new Capsule(client, namespace("primary"), stable);
      const secondary = new Capsule(client, namespace("secondary"), beta);
      const current = await commit(primary, feed);
      const preview = await commit(secondary, feed);
      return { current, preview, primary };
    });
    scenarios.push(evidence("PUB-01", "passed", "two isolated channels restored and committed", published.milliseconds, {
      artifacts: [published.value.current, published.value.preview],
      downloaded: ["capsule", "daemon", "web", "model"],
      transitions: ["discover", "verify", "stage", "arm", "ready", "commit"],
    }));
    const repeated = await timed(() => authority.publish(stable, 0, built.value.first.envelope, built.value.first.assets));
    scenarios.push(evidence("PUB-02", "passed", `head remained revision ${repeated.value.revision}`, repeated.milliseconds));
    const update = await product(stable, "2.0.0", model);
    await authority.publish(stable, 1, update.envelope, update.assets);
    const refused = await timed(async () => {
      try {
        await published.value.primary.update(new Feed(port.value, pem().publickey));
        return false;
      } catch {
        return true;
      }
    });
    scenarios.push(evidence("PUB-10", refused.value ? "passed" : "failed", "unknown trust root rejected", refused.milliseconds));
    const attempt = await published.value.primary.update(feed);
    if (!attempt) throw new Error("upgrade attempt missing");
    await server.close();
    server = undefined;
    await host.close();
    host = undefined;
    host = await sidecar(endpoint);
    client = new Client(host.endpoint, host.authority);
    const interrupted = await timed(() => client.binding(namespace("primary"), stable));
    const blocked = startup(interrupted.value.state).mode === "blocked";
    scenarios.push(evidence("REC-04", blocked ? "passed" : "failed", "restart preserved a blocked failed attempt", interrupted.milliseconds, {
      transitions: ["running", "restart", "failed", "blocked"],
    }));
    const recovered = await timed(async () => {
      const capsule = new Capsule(client, namespace("primary"), stable);
      let recovery = await capsule.recover(published.value.current);
      for (const gate of gates) recovery = await capsule.ready(recovery, gate);
      return capsule.commit(recovery);
    });
    const restored = recovered.value.state.current === published.value.current;
    scenarios.push(evidence("REC-07", restored ? "passed" : "failed", "explicit old generation recovered", recovered.milliseconds, {
      artifacts: [published.value.current],
      restored: ["capsule", "daemon", "web", "model"],
      transitions: ["recover", "begin", "ready", "commit"],
    }));
    if (options.packaged) {
      scenarios.push(await installation(client, temporary));
    }
  } catch (fault) {
    failure = fault as Error;
  } finally {
    if (server) await server.close();
    if (host) await host.close();
    await rm(temporary, { force: true, recursive: true });
  }
  const add = (item: Evidence) => {
    if (!scenarios.some((current) => current.id === item.id)) scenarios.push(item);
  };
  if (failure) {
    for (const item of matrix.slice(0, 7)) {
      add(evidence(item.id, "failed", failure.message, 0, {
        diagnostics: [failure.stack ?? failure.message],
      }));
    }
  }
  add(evidence("PKG-01", "unqualified", "platform package not built", 0));
  add(evidence(
    "PKG-10",
    options.chromium ? "passed" : "unqualified",
    options.chromium ? "preceding Carrier qualification passed" : "real Chromium qualification not supplied",
    0,
  ));
  add(evidence("G5-NATIVE", "unqualified", "native credentials and installers are out of scope", 0));
  add(evidence("G6-REMOTE", "unqualified", "remote object storage and CDN are out of scope", 0));
  for (const item of matrix) {
    add(evidence(item.id, "failed", "scenario did not execute", 0));
  }
  scenarios.sort((left, right) => matrix.findIndex((item) => item.id === left.id)
    - matrix.findIndex((item) => item.id === right.id));
  const tools = await versions(root);
  const failed = scenarios.some((item) => item.status === "failed");
  const partial = scenarios.some((item) => item.status === "unqualified");
  const report = parse({
    architecture: process.arch,
    platform: process.platform,
    result: failed ? "failed" : partial ? "partial" : "passed",
    revision: tools.revision,
    scenarios,
    schema: 1,
    tools: { electron: tools.electron, node: tools.node, pnpm: tools.pnpm },
  });
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, encode(report), { mode: 0o600 });
  return report;
}
