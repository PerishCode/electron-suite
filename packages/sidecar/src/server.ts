import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmod } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { dirname } from "node:path";

import {
  namespace,
  type Capability,
  type Namespace,
  type Permit,
} from "@perish/protocol";

import { Bindings } from "./binding.js";
import { Sidecar } from "./host.js";
import { Resources } from "./resource.js";
import { decode, encode, type Request, type Response } from "./wire.js";

export interface Service {
  authority: string;
  close(): Promise<void>;
  endpoint: string;
}

const limit = 64 * 1024;

function equal(left: string, right: string): boolean {
  const first = Buffer.from(left);
  const second = Buffer.from(right);
  return first.length === second.length && timingSafeEqual(first, second);
}

interface Runtime {
  bindings: Bindings;
  capabilities: Map<string, Capability>;
  host: Sidecar;
  open(value: string): Promise<Resources>;
}

function key(permit: Permit): string {
  return [permit.namespace, permit.channel, permit.owner, permit.service].join(":");
}

function issue(runtime: Runtime, permit: Permit): Capability {
  const identity = key(permit);
  let capability = runtime.capabilities.get(identity);
  if (!capability) {
    capability = { ...permit, token: randomBytes(32).toString("base64url") };
    runtime.capabilities.set(identity, capability);
  }
  return capability;
}

function retire(runtime: Runtime, capability: Capability): boolean {
  const identity = key(capability);
  const current = runtime.capabilities.get(identity);
  if (!current || !equal(current.token, capability.token)) return false;
  return runtime.capabilities.delete(identity);
}

async function dispatch(runtime: Runtime, authority: string, request: Request) {
  if (request.type === "start") {
    if (!equal(request.authority, authority)) throw new Error("invalid authority");
    return runtime.host.start(request.spec);
  }

  if (request.type === "attach") return runtime.host.attach(request.lease);
  if (request.type === "release") return runtime.host.release(request.lease);
  if (!equal(request.authority, authority)) throw new Error("invalid authority");
  if (request.type === "inspect") return runtime.host.inspect();
  if (request.type === "binding") return runtime.bindings.read(request.namespace, request.channel);
  if (request.type === "transit") {
    return runtime.bindings.transit(request.namespace, request.channel, request.revision, request.event);
  }
  if (request.type === "issue") return issue(runtime, request.permit);
  if (request.type === "retire") return retire(runtime, request.capability);
  const resources = await runtime.open(request.namespace);
  if (request.type === "grant") return resources.grant(request.resource);
  if (request.type === "forward") {
    await resources.forward(request.port, request.socket);
  }
  if (request.type === "revoke") {
    await resources.release(request.lease, request.survivors);
  }
  return resources.snapshot();
}

function reply(socket: Socket, response: Response): void {
  if (!socket.destroyed) socket.end(encode(response));
}

function accept(server: Server, runtime: Runtime, authority: string): void {
  server.on("connection", (socket) => {
    let input = "";

    socket.on("data", (chunk: Buffer) => {
      input += chunk.toString("utf8");

      if (Buffer.byteLength(input) > limit) {
        reply(socket, { error: "request exceeds limit", ok: false });
        return;
      }

      const end = input.indexOf("\n");
      if (end < 0) return;
      socket.pause();

      Promise.resolve(input.slice(0, end))
        .then(decode)
        .then((request) => dispatch(runtime, authority, request))
        .then((value) => reply(socket, { ok: true, value }))
        .catch((error: Error) => reply(socket, { error: error.message, ok: false }));
    });
  });
}

function listen(server: Server, endpoint: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(endpoint, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

export async function serve(
  endpoint: string,
  host = new Sidecar(),
  authority = randomBytes(32).toString("base64url"),
  root = dirname(endpoint),
): Promise<Service> {
  const hosts = new Map<Namespace, Promise<Resources>>();
  const runtime: Runtime = {
    bindings: new Bindings(root),
    capabilities: new Map(),
    host,
    open: (value) => {
      const name = namespace(value);
      let pending = hosts.get(name);
      if (!pending) {
        pending = Resources.open({ namespace: name, root });
        hosts.set(name, pending);
        pending.catch(() => hosts.delete(name));
      }
      return pending;
    },
  };
  const server = createServer();
  accept(server, runtime, authority);
  await listen(server, endpoint);
  if (process.platform !== "win32") await chmod(endpoint, 0o600);

  return {
    authority,
    endpoint,
    close: async () => {
      await close(server);
      await host.close();
      await Promise.all([...hosts.values()].map(async (pending) => (await pending).close()));
    },
  };
}
