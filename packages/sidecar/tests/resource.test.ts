import { mkdtemp, readFile, stat } from "node:fs/promises";
import { connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { namespace } from "@perish/protocol";
import { afterEach, describe, expect, it } from "vitest";

import { Resources } from "@";

const hosts: Resources[] = [];

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((item) => item.close()));
});

async function create(name: string, root?: string): Promise<{ host: Resources; root: string }> {
  const directory = root ?? await mkdtemp(join(tmpdir(), "perish-resource-"));
  const host = await Resources.open({ namespace: namespace(name), root: directory });
  hosts.push(host);
  return { host, root: directory };
}

describe("resources", () => {
  it("keeps a granted port reserved until release", async () => {
    const { host } = await create("first");
    const grant = await host.grant({ kind: "port", name: "daemon", owner: "attempt", scope: "attempt" });
    const address = new URL(grant.value);
    const contender = createServer();

    await expect(new Promise<void>((done, reject) => {
      contender.once("error", reject);
      contender.listen(Number(address.port), address.hostname, done);
    })).rejects.toMatchObject({ code: "EADDRINUSE" });

    await host.release(grant.lease);
    await new Promise<void>((done, reject) => {
      contender.once("error", reject);
      contender.listen(Number(address.port), address.hostname, done);
    });
    await new Promise<void>((done) => contender.close(() => done()));
  });

  it("isolates durable paths by namespace and persists their truth", async () => {
    const root = await mkdtemp(join(tmpdir(), "perish-resource-"));
    const first = await create("first", root);
    const second = await create("second", root);
    const left = await first.host.grant({ kind: "data", name: "daemon", scope: "namespace" });
    const right = await second.host.grant({ kind: "data", name: "daemon", scope: "namespace" });

    expect(left.value).not.toBe(right.value);
    expect(await first.host.grant({ kind: "data", name: "daemon", scope: "namespace" })).toEqual(left);
    const stored = JSON.parse(await readFile(join(root, "namespaces", "first", "registry.json"), "utf8"));
    expect(stored.grants).toEqual([left]);
  });

  it("reaps stale attempt resources when its namespace reopens", async () => {
    const root = await mkdtemp(join(tmpdir(), "perish-resource-"));
    const first = await create("main", root);
    const staging = await first.host.grant({
      kind: "staging",
      name: "capsule",
      owner: "attempt",
      scope: "attempt",
    });
    await first.host.close();
    hosts.splice(hosts.indexOf(first.host), 1);

    const second = await create("main", root);
    expect(second.host.snapshot().grants).toEqual([]);
    await expect(stat(staging.value)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses scope confusion and cleanup with survivors", async () => {
    const { host } = await create("main");
    await expect(host.grant({ kind: "data", name: "daemon", owner: "attempt", scope: "attempt" }))
      .rejects.toThrow("scope mismatch");
    const grant = await host.grant({ kind: "lock", name: "daemon", owner: "attempt", scope: "attempt" });
    await expect(host.release(grant.lease, [process.pid])).rejects.toThrow("survivors");
    expect(host.snapshot().grants).toContainEqual(grant);
  });

  it.runIf(process.platform !== "win32")("forwards a held port to a granted socket", async () => {
    const { host } = await create("main");
    const owner = "attempt";
    const port = await host.grant({ kind: "port", name: "daemon", owner, scope: "attempt" });
    const socket = await host.grant({ kind: "socket", name: "daemon", owner, scope: "attempt" });
    const target = createServer((connection) => connection.end("ready"));
    await new Promise<void>((done, reject) => {
      target.once("error", reject);
      target.listen(socket.value, done);
    });
    await host.forward(port.lease, socket.lease);
    const address = new URL(port.value);

    const output = await new Promise<string>((done, reject) => {
      const client = connect(Number(address.port), address.hostname);
      let value = "";
      client.on("data", (chunk) => value += chunk.toString());
      client.once("end", () => done(value));
      client.once("error", reject);
    });

    expect(output).toBe("ready");
    await new Promise<void>((done) => target.close(() => done()));
  });
});
