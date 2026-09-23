import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm, writeFile, type FileHandle } from "node:fs/promises";
import { createConnection, createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  allocate,
  canonical,
  digest,
  namespace,
  resources,
  revoke,
  type Grant,
  type Namespace,
  type Registry,
  type Request,
  type Resource,
} from "@perish/protocol";

const durable = new Set<Resource>(["cache", "cas", "data", "logs"]);
const transient = new Set<Resource>(["lock", "port", "socket", "staging"]);

export interface ResourceOptions {
  namespace: Namespace;
  root: string;
}

type Handle =
  | { kind: "file"; value: FileHandle }
  | { kind: "server"; value: Server };

function same(left: Request, right: Request): boolean {
  return left.kind === right.kind
    && left.name === right.name
    && left.owner === right.owner
    && left.scheme === right.scheme
    && left.scope === right.scope;
}

function path(base: string, request: Request, lease: string): string {
  const token = digest(canonical({ lease, owner: request.owner ?? "namespace" })).slice(7, 23);
  if (request.kind === "socket") {
    const root = digest(base).slice(7, 23);
    const user = typeof process.getuid === "function" ? process.getuid() : "user";
    return join(tmpdir(), `perish-${user}`, root, `${token}.sock`);
  }
  return join(base, request.kind, request.name, token);
}

async function reserve(scheme = "tcp"): Promise<{ handle: Handle; value: string }> {
  const server = createServer();
  await new Promise<void>((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      done();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("port reservation failed");
  return {
    handle: { kind: "server", value: server },
    value: `${scheme}://${address.address}:${address.port}`,
  };
}

async function close(handle: Handle): Promise<void> {
  if (handle.kind === "file") {
    await handle.value.close();
    return;
  }
  await new Promise<void>((done, reject) => {
    handle.value.close((fault) => fault ? reject(fault) : done());
  });
}

function registry(value: unknown, base: string, name: Namespace): Registry {
  if (!value || typeof value !== "object") throw new TypeError("invalid registry");
  const state = value as Registry;
  if (state.namespace !== name || !Number.isSafeInteger(state.revision) || state.revision < 0) {
    throw new TypeError("invalid registry");
  }
  if (!Array.isArray(state.grants)) throw new TypeError("invalid registry");
  for (const grant of state.grants) {
    if (!grant || typeof grant !== "object" || !resources.includes(grant.kind)) {
      throw new TypeError("invalid registry grant");
    }
    if (!grant.lease || !grant.value || !/^[a-z][a-z0-9]*$/.test(grant.name)) {
      throw new TypeError("invalid registry grant");
    }
    if (grant.kind === "port" && !["http", "tcp"].includes(grant.scheme ?? "tcp")) {
      throw new TypeError("invalid registry scheme");
    }
    if (grant.kind !== "port" && grant.scheme !== undefined) throw new TypeError("invalid registry scheme");
    const scoped = grant.scope === "namespace" && grant.owner === undefined && durable.has(grant.kind);
    const attempted = grant.scope === "attempt" && Boolean(grant.owner) && transient.has(grant.kind);
    if (!scoped && !attempted) throw new TypeError("invalid registry scope");
    if (grant.kind !== "port" && grant.value !== path(base, grant, grant.lease)) {
      throw new TypeError("invalid registry path");
    }
  }
  return state;
}

export class Resources {
  readonly #base: string;
  readonly #file: string;
  readonly #handles = new Map<string, Handle>();
  #pending = Promise.resolve();
  #state: Registry;

  private constructor(base: string, state: Registry) {
    this.#base = base;
    this.#file = join(base, "registry.json");
    this.#state = state;
  }

  static async open(options: ResourceOptions): Promise<Resources> {
    const name = namespace(options.namespace);
    const base = resolve(options.root, "namespaces", name);
    await mkdir(base, { mode: 0o700, recursive: true });
    await chmod(base, 0o700);
    let state: Registry = { grants: [], namespace: name, revision: 0 };
    try {
      state = registry(JSON.parse(await readFile(join(base, "registry.json"), "utf8")), base, name);
    } catch (fault) {
      if ((fault as NodeJS.ErrnoException).code !== "ENOENT") throw fault;
    }

    const stale = state.grants.filter((grant) => grant.scope === "attempt");
    state = {
      ...state,
      grants: state.grants.filter((grant) => grant.scope === "namespace"),
      revision: state.revision + (stale.length > 0 ? 1 : 0),
    };
    const host = new Resources(base, state);
    for (const grant of stale) await host.#remove(grant);
    await host.#save();
    return host;
  }

  snapshot(): Registry {
    return structuredClone(this.#state);
  }

  grant(request: Request): Promise<Grant> {
    return this.#run(() => this.#grant(request));
  }

  release(lease: string, survivors: number[] = []): Promise<void> {
    return this.#run(() => this.#release(lease, survivors));
  }

  forward(port: string, socket: string): Promise<void> {
    return this.#run(async () => {
      const source = this.#state.grants.find((item) => item.lease === port);
      const target = this.#state.grants.find((item) => item.lease === socket);
      const handle = this.#handles.get(port);
      if (source?.kind !== "port" || target?.kind !== "socket" || handle?.kind !== "server") {
        throw new Error("invalid forward grants");
      }
      handle.value.on("connection", (incoming) => {
        const outgoing = createConnection(target.value);
        incoming.pipe(outgoing).pipe(incoming);
        outgoing.once("error", () => incoming.destroy());
        incoming.once("error", () => outgoing.destroy());
      });
    });
  }

  close(): Promise<void> {
    return this.#run(async () => {
      const handles = [...this.#handles.values()];
      this.#handles.clear();
      await Promise.all(handles.map(close));
    });
  }

  async #grant(request: Request): Promise<Grant> {
    const current = this.#state.grants.find((item) => same(item, request));
    if (current) return current;
    if (durable.has(request.kind) !== (request.scope === "namespace")) {
      throw new TypeError("resource scope mismatch");
    }
    if (!durable.has(request.kind) && !transient.has(request.kind)) {
      throw new TypeError("unsupported resource");
    }

    const lease = randomUUID();
    const material = await this.#create(request, lease);
    const grant = { ...request, lease, value: material.value };
    const result = allocate(this.#state, grant);
    if (!result.ok) {
      await this.#cleanup(grant, material.handle);
      throw new Error(`resource ${result.fault}`);
    }

    const before = this.#state;
    this.#state = result.state;
    if (material.handle) this.#handles.set(lease, material.handle);
    try {
      await this.#save();
    } catch (fault) {
      this.#state = before;
      this.#handles.delete(lease);
      await this.#cleanup(grant, material.handle);
      throw fault;
    }
    return grant;
  }

  async #release(lease: string, survivors: number[]): Promise<void> {
    const result = revoke(this.#state, lease, survivors);
    if (!result.ok) throw new Error(`resource ${result.fault}`);
    const grant = this.#state.grants.find((item) => item.lease === lease);
    if (!grant) throw new Error("resource unknown");
    await this.#cleanup(grant, this.#handles.get(lease));
    this.#handles.delete(lease);
    this.#state = result.state;
    await this.#save();
  }

  async #create(request: Request, lease: string): Promise<{ handle?: Handle; value: string }> {
    if (request.kind === "port") return reserve(request.scheme);
    const value = path(this.#base, request, lease);
    if (request.kind === "lock") {
      await mkdir(resolve(value, ".."), { recursive: true });
      return { handle: { kind: "file", value: await open(value, "wx") }, value };
    }
    if (request.kind === "socket") {
      await mkdir(resolve(value, ".."), { mode: 0o700, recursive: true });
      return { value };
    }
    await mkdir(value, { mode: 0o700, recursive: true });
    return { value };
  }

  async #cleanup(grant: Grant, handle?: Handle): Promise<void> {
    if (handle) await close(handle);
    await this.#remove(grant);
  }

  async #remove(grant: Grant): Promise<void> {
    if (grant.kind === "port") return;
    if (grant.value !== path(this.#base, grant, grant.lease)) {
      throw new Error("resource escaped namespace");
    }
    await rm(grant.value, {
      force: true,
      recursive: grant.kind !== "lock" && grant.kind !== "socket",
    });
  }

  async #run<T>(action: () => Promise<T>): Promise<T> {
    const result = this.#pending.then(action, action);
    this.#pending = result.then(() => undefined, () => undefined);
    return result;
  }

  async #save(): Promise<void> {
    const temporary = join(this.#base, "registry.tmp");
    await writeFile(temporary, `${canonical(this.#state)}\n`, { mode: 0o600 });
    await rename(temporary, this.#file);
  }
}
