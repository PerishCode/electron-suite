import { mkdtemp, rm } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { channel, digest, namespace } from "@perish/protocol";
import { Client, serve, type Lease, type Service } from "@perish/sidecar";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
const services: Service[] = [];

function call(endpoint: string, path: string, token: string, value?: unknown): Promise<{ body: unknown; status: number }> {
  const address = new URL(endpoint);
  const body = value === undefined ? undefined : JSON.stringify(value);
  return new Promise((resolve, reject) => {
    const operation = request({
      headers: {
        ...(body ? { "content-length": Buffer.byteLength(body) } : {}),
        authorization: `Bearer ${token}`,
        origin: "perish://carrier",
      },
      host: address.hostname,
      method: body ? "PUT" : "GET",
      path,
      port: address.port,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.once("end", () => resolve({
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
        status: response.statusCode ?? 0,
      }));
    });
    operation.once("error", reject);
    operation.end(body);
  });
}

function preflight(endpoint: string, origin: string): Promise<{ allow?: string; status: number }> {
  const address = new URL(endpoint);
  return new Promise((resolve, reject) => {
    const operation = request({
      headers: { origin },
      host: address.hostname,
      method: "OPTIONS",
      path: "/state",
      port: address.port,
    }, (response) => {
      response.resume();
      response.once("end", () => resolve({
        allow: response.headers["access-control-allow-origin"],
        status: response.statusCode ?? 0,
      }));
    });
    operation.once("error", reject);
    operation.end();
  });
}

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("daemon", () => {
  it.runIf(process.platform !== "win32")("consumes only sidecar granted resources", async () => {
    const root = await mkdtemp(join(tmpdir(), "perish-daemon-"));
    roots.push(root);
    const endpoint = join(root, "sidecar.sock");
    const sidecar = await serve(endpoint);
    services.push(sidecar);
    const client = new Client(endpoint, sidecar.authority);
    const scope = namespace("main");
    const owner = "attempt";
    const token = "fixturesecret";
    const data = await client.grant(scope, { kind: "data", name: "daemon", scope: "namespace" });
    const socket = await client.grant(scope, { kind: "socket", name: "daemon", owner, scope: "attempt" });
    const port = await client.grant(scope, { kind: "port", name: "daemon", owner, scope: "attempt" });
    const env = {
      PERISH_DATA: data.value,
      PERISH_ORIGIN: "perish://carrier",
      PERISH_SOCKET: socket.value,
      PERISH_TOKEN: token,
    };
    const here = dirname(fileURLToPath(import.meta.url));
    let lease: Lease | undefined;

    try {
      lease = await client.start({
        args: [join(here, "../dist/main.mjs")],
        channel: channel("stable"),
        command: process.execPath,
        env,
        generation: digest("daemonone"),
        namespace: scope,
        ready: "ready",
        slot: "daemon",
      });
      await client.forward(scope, port.lease, socket.lease);

      expect(await preflight(port.value, "https://forged.invalid")).toMatchObject({ status: 403 });
      expect(await preflight(port.value, "perish://carrier")).toEqual({
        allow: "perish://carrier",
        status: 204,
      });
      expect(await call(port.value, "/health", "forged")).toMatchObject({ status: 401 });
      expect(await call(port.value, "/health", token)).toMatchObject({ body: { ok: true }, status: 200 });
      expect(await call(port.value, "/state", token, { value: 42 })).toEqual({ body: { value: 42 }, status: 200 });
      await client.release(lease);
      lease = await client.start({
        args: [join(here, "../dist/main.mjs")],
        channel: channel("stable"),
        command: process.execPath,
        env,
        generation: digest("daemontwo"),
        namespace: scope,
        ready: "ready",
        slot: "daemon",
      });
      expect(await call(port.value, "/state", token)).toEqual({ body: { value: 42 }, status: 200 });
    } finally {
      if (lease) await client.release(lease);
      await client.revoke(scope, port.lease);
      await client.revoke(scope, socket.lease);
    }
  });
});
