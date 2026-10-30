import { randomUUID } from "node:crypto";
import {
  chmod,
  type FileHandle,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { createConnection, createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  allocate,
  canonical,
  digest,
  type Grant,
  type Namespace,
  namespace,
  type Registry,
  type Request,
  type Resource,
  resources,
  revoke,
} from "@perishcode/protocol";
import { Ownership } from "./ownership.js";

const durable = new Set<Resource>(["cache", "cas", "data", "logs"]);
const transient = new Set<Resource>(["lock", "port", "socket", "staging"]);

export interface ResourceOptions {
  namespace: Namespace;
  root: string;
}

type Handle = { kind: "file"; value: FileHandle } | { kind: "server"; value: Server };

function same(left: Request, right: Request): boolean {
  return (
    left.kind === right.kind &&
    left.name === right.name &&
    left.owner === right.owner &&
    left.scheme === right.scheme &&
    left.scope === right.scope
  );
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
    handle.value.close((fault) => (fault ? reject(fault) : done()));
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
  #closing = false;
  #closed = false;
  #shutdown?: Promise<void>;
  readonly incarnation: string;

  private constructor(
    base: string,
    state: Registry,
    private ownership: Ownership,
  ) {
    this.incarnation = ownership.incarnation;
    this.#base = base;
    this.#file = join(base, "registry.json");
    this.#state = state;
  }

  static async open(options: ResourceOptions): Promise<Resources> {
    const name = namespace(options.namespace);
    await mkdir(options.root, { mode: 0o700, recursive: true });
    const root = await realpath(options.root);
    const namespaces = join(root, "namespaces");
    await mkdir(namespaces, { mode: 0o700, recursive: true });
    if (!(await lstat(namespaces)).isDirectory()) throw new Error("namespace root must be a regular directory");
    const base = join(namespaces, name);
    await mkdir(base, { mode: 0o700, recursive: true });
    if (!(await lstat(base)).isDirectory()) throw new Error("namespace must be a regular directory");
    await chmod(base, 0o700);
    const ownership = await Ownership.claim(join(base, "ownership.sqlite"));
    try {
      let state: Registry = { grants: [], namespace: name, revision: 0 };
      try {
        state = registry(JSON.parse(await readFile(join(base, "registry.json"), "utf8")), base, name);
      } catch (fault) {
        if ((fault as NodeJS.ErrnoException).code !== "ENOENT") throw fault;
        if (!ownership.fresh) throw new Error("resource registry missing; recovery required");
      }

      const stale = state.grants.filter((grant) => grant.scope === "attempt");
      if (ownership.fresh && stale.length)
        throw new Error("attempt resources have unpublished ownership; recovery required");
      state = {
        ...state,
        grants: state.grants.filter((grant) => grant.scope === "namespace"),
        revision: state.revision + (stale.length > 0 ? 1 : 0),
      };
      const host = new Resources(base, state, ownership);
      for (const grant of stale) await host.#remove(grant);
      await host.#save();
      return host;
    } catch (fault) {
      ownership.abandon();
      throw fault;
    }
  }

  snapshot(): Registry {
    if (this.#closed) throw new Error("resources are closed");
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
    if (this.#closed) return Promise.resolve();
    this.#closing = true;
    this.#shutdown ??= this.#pending
      .then(async () => {
        for (const [lease, handle] of this.#handles) {
          await close(handle);
          this.#handles.delete(lease);
        }
        this.ownership.close();
        this.#closed = true;
      })
      .catch((fault) => {
        this.#shutdown = undefined;
        throw fault;
      });
    this.#pending = this.#shutdown.then(
      () => undefined,
      () => undefined,
    );
    return this.#shutdown;
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
    const before = this.#state;
    this.#state = result.state;
    try {
      await this.#save();
    } catch (fault) {
      this.#state = before;
      throw fault;
    }
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
    if (this.#closing || this.#closed) return Promise.reject(new Error("resources are closing or closed"));
    const result = this.#pending.then(action, action);
    this.#pending = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async #save(): Promise<void> {
    const temporary = join(this.#base, "registry.tmp");
    await writeFile(temporary, `${canonical(this.#state)}\n`, { mode: 0o600 });
    await rename(temporary, this.#file);
  }
}
