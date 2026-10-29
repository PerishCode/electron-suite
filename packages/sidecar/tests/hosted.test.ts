import { execFile } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { channel, digest, namespace } from "@perishcode/protocol";
import { afterEach, expect, it } from "vitest";
import { Client, type Expose, type Service, serve } from "@";

type Methods = { echo: { input: string; output: string }; count: { input: number; output: number } };
const identity = {
  channel: channel("stable"),
  namespace: namespace("probe"),
  generation: digest("first"),
  service: "probe",
};
const services: Service[] = [];
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((s) => s.close()));
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});
function deferred() {
  let done = () => {};
  const promise = new Promise<void>((r) => {
    done = r;
  });
  return { promise, done };
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "hosted-"));
  roots.push(root);
  const server = await serve(join(root, "manager.sock"));
  services.push(server);
  const client = new Client(server.endpoint, server.authority);
  const options: Expose<Methods> = {
    identity,
    handlers: { echo: async (s) => s, count: async (n) => n + 1 },
    lifecycle: { initialize: async () => {}, stop: async () => {} },
  };
  return { root, server, client, options };
}

it("provides caller-owned methods to a separate process and injects managed roots", async () => {
  const { root, server, client, options } = await fixture();
  const attached = await server.expose(options);
  for (const path of Object.values(attached.context.roots)) {
    expect(path.startsWith(`${root}/`)).toBe(true);
    expect((await stat(path)).isDirectory()).toBe(true);
  }
  const peer = await client.connect<Methods>(identity);
  expect(await peer.call("count", 4)).toBe(5);
  const probe = await peer.probe();
  expect(probe.identity).toEqual(identity);
  expect(JSON.stringify(probe)).not.toContain("token");
  const script = `import {Client} from ${JSON.stringify(new URL("../dist/index.mjs", import.meta.url).href)};
    const peer = await new Client(process.argv[1],process.env.PESUITE_TEST_AUTHORITY).connect(JSON.parse(process.argv[2]));
    process.stdout.write(JSON.stringify(await peer.call('echo','separate process')));`;
  const result = await promisify(execFile)(
    process.execPath,
    ["--input-type=module", "-e", script, server.endpoint, JSON.stringify(identity)],
    { env: { ...process.env, PESUITE_TEST_AUTHORITY: server.authority } },
  );
  expect(JSON.parse(result.stdout)).toBe("separate process");
  await peer.stop();
  await attached.closed;
  await expect(stat(attached.context.roots.runtime)).rejects.toMatchObject({ code: "ENOENT" });
  expect((await stat(attached.context.roots.data)).isDirectory()).toBe(true);
});

it("does not publish readiness until initialize completes; duplicate exposure cannot take ownership", async () => {
  const { server, client, options } = await fixture();
  const gate = deferred();
  options.lifecycle.initialize = () => gate.promise;
  const opening = server.expose(options);
  await expect(client.connect(identity)).rejects.toThrow("not ready");
  await expect(server.expose(options)).rejects.toThrow("already owned");
  gate.done();
  const attached = await opening;
  expect((await (await client.connect(identity)).probe()).phase).toBe("ready");
  await attached.close();
});

it("fences old clients and old attachment close after same-generation replacement", async () => {
  const { server, client, options } = await fixture();
  const first = await server.expose(options);
  const old = await client.connect<Methods>(identity);
  await first.close();
  const second = await server.expose(options);
  await first.close();
  await expect(old.call("count", 0)).rejects.toThrow("fenced");
  await expect(old.stop()).rejects.toThrow("fenced");
  expect(await (await client.connect<Methods>(identity)).call("echo", "new")).toBe("new");
  expect(second.context.incarnation).not.toBe(first.context.incarnation);
});

it("drains in-flight calls and coalesces local and remote stop", async () => {
  const { server, client, options } = await fixture();
  const entered = deferred();
  const gate = deferred();
  let stops = 0;
  options.handlers.echo = async () => {
    entered.done();
    await gate.promise;
    return "drained";
  };
  options.lifecycle.stop = async () => {
    stops++;
  };
  const attached = await server.expose(options);
  const peer = await client.connect<Methods>(identity);
  const call = peer.call("echo", "");
  await entered.promise;
  const stopping = attached.close();
  const remote = peer.stop();
  expect((await peer.probe()).phase).toBe("stopping");
  await expect(peer.call("count", 1)).rejects.toThrow("not ready");
  expect(stops).toBe(0);
  gate.done();
  expect(await call).toBe("drained");
  await Promise.all([stopping, remote, attached.closed]);
  expect(stops).toBe(1);
});

it("retains ownership and temporary resources when stop fails; allows an explicit retry", async () => {
  const { server, client, options } = await fixture();
  let fail = true;
  options.lifecycle.stop = async () => {
    if (fail) throw new Error("body still owns resources");
  };
  const attached = await server.expose(options);
  const peer = await client.connect<Methods>(identity);
  await expect(attached.close()).rejects.toThrow("still owns");
  expect((await peer.probe()).phase).toBe("failed");
  expect((await stat(attached.context.roots.runtime)).isDirectory()).toBe(true);
  await expect(server.expose(options)).rejects.toThrow("already owned");
  await expect(server.close()).rejects.toThrow("did not drain");
  await expect(server.expose<Methods>({ ...options, identity: { ...identity, service: "other" } })).rejects.toThrow(
    "closing",
  );
  fail = false;
  await attached.close();
  await attached.closed;
});

it("drains initialization failure before allowing a replacement", async () => {
  const { server, client, options } = await fixture();
  let drained = false;
  options.lifecycle.initialize = async () => {
    throw new Error("init failed");
  };
  options.lifecycle.stop = async () => {
    drained = true;
  };
  await expect(server.expose(options)).rejects.toThrow("init failed");
  expect(drained).toBe(true);
  await expect(client.connect(identity)).rejects.toThrow("not ready");
  options.lifecycle.initialize = async () => {};
  await server.expose(options);
});

it("does not let shutdown retire a service while initialization is still running", async () => {
  const { server, options } = await fixture();
  const gate = deferred();
  let drained = false;
  options.lifecycle.initialize = () => gate.promise;
  options.lifecycle.stop = async () => {
    drained = true;
  };
  const opening = server.expose(options);
  const rejected = expect(opening).rejects.toThrow("stopped during initialization");
  const stopping = server.close();
  expect(drained).toBe(false);
  gate.done();
  await Promise.all([rejected, stopping]);
  expect(drained).toBe(true);
});

it("rejects non-serializable call input without crashing the host", async () => {
  const { server, client, options } = await fixture();
  await server.expose(options);
  const peer = await client.connect<Methods>(identity);
  await expect(peer.call("count", 1n as unknown as number)).rejects.toThrow();
  expect(await peer.call("count", 1)).toBe(2);
  await expect(client.connect({ ...identity, namespace: namespace("other") })).rejects.toThrow("not ready");
});

it("holds a managed port, forwards only owned sockets and releases resources after body drain", async () => {
  const { server, client, options } = await fixture();
  const http = createServer((_request, response) => response.end("caller protocol"));
  let endpoint = "";
  let socketPath = "";
  options.lifecycle.initialize = async (context) => {
    const socket = await context.allocate({ kind: "socket", name: "transport" });
    const port = await context.allocate({ kind: "port", name: "transport", scheme: "http" });
    socketPath = socket.value;
    endpoint = port.value;
    await new Promise<void>((done, reject) => {
      http.once("error", reject);
      http.listen(socket.value, done);
    });
    await expect(context.forward(port.value, "/unowned.sock")).rejects.toThrow("ownership mismatch");
    await context.forward(port.value, socket.value);
  };
  options.lifecycle.stop = () =>
    new Promise<void>((done, reject) => http.close((error) => (error ? reject(error) : done())));
  const attached = await server.expose(options);
  expect(await (await fetch(endpoint, { headers: { connection: "close" } })).text()).toBe("caller protocol");
  const grants = (await client.resources(identity.namespace)).grants;
  expect(grants.filter((g) => g.kind === "port" || g.kind === "socket")).toHaveLength(2);
  await attached.close();
  await expect(fetch(endpoint, { signal: AbortSignal.timeout(1000) })).rejects.toThrow();
  await expect(stat(socketPath)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(attached.context.allocate({ kind: "port", name: "late" })).rejects.toThrow("not allocating");
  expect((await client.resources(identity.namespace)).grants.every((g) => g.scope === "namespace")).toBe(true);
});
