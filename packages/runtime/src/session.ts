import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { channel, type Digest, gates, namespace } from "@perishcode/protocol";
import { decode, type Manifest } from "@perishcode/release";
import {
  Client,
  type Directory,
  type Expose,
  type Factory,
  type FactoryScope,
  type Lease,
  type Service,
  serve,
} from "@perishcode/sidecar";
import { type Attempt, Capsule, type Mount } from "./capsule.js";
import { readProduct } from "./product.js";

export interface Context {
  blobs: Record<string, string>;
  generation: Digest;
  nonce: string;
}
export interface Payload {
  title: string;
  witness: string;
}
export interface SessionOptions {
  carrier: number;
  candidate?: string;
  executable: string;
  manifest: Manifest;
  namespace: string;
  recover?: boolean;
  root: string;
  seed: string;
}
export interface Receipt {
  factory: Readonly<FactoryScope>;
  directory: Directory;
  capsule: string;
  daemon: Record<string, unknown>;
  generation: Digest;
  nonce: string;
  pid: number;
  renderer: string;
  schema: 1;
}

export class Session {
  private attempt?: Attempt;
  private lease?: Lease;
  private capability?: Awaited<ReturnType<Client["issue"]>>;
  private transient: string[] = [];
  private closed = false;
  private closing?: Promise<{ status: string; survivors: number[] }>;
  private ready = false;
  content() {
    if (this.closed || this.closing) throw new Error("session is closed");
    return this.capsule.content(this.mount.target);
  }
  async expose<M>(service: string, options: Omit<Expose<M>, "identity">) {
    if (this.closed || this.closing) throw new Error("session is closed");
    return this.host
      .factory(this.factory.scope)
      .expose({ ...options, identity: { service, generation: this.mount.target } });
  }
  private constructor(
    readonly options: SessionOptions,
    private host: Service,
    private factory: Factory,
    private capsule: Capsule,
    readonly mount: Mount,
    readonly manifest: Manifest,
    readonly nonce: string,
  ) {}

  static async open(options: SessionOptions): Promise<Session> {
    await mkdir(options.root, { recursive: true, mode: 0o700 });
    // The Electron adapter holds an OS single-instance lock for this root.
    const key = createHash("sha256").update(options.root).digest("hex").slice(0, 20);
    const endpoint = join(tmpdir(), `pesuite-${key}-${process.pid}.sock`);
    const host = await serve(endpoint, undefined, undefined, options.root);
    const client = new Client(host.endpoint, host.authority);
    const scope = namespace(options.namespace);
    const lane = channel(options.manifest.channel);
    const capsule = new Capsule(client, scope, lane, options.carrier);
    const factory = capsule.factory;
    let attempt: Attempt | undefined;
    try {
      const current = (await factory.binding()).state;
      if (options.recover) {
        if (!current.current) throw new Error("no committed generation to recover");
        attempt = await capsule.recover(current.current);
      } else if (options.candidate || !current.current) {
        const product = await readProduct(options.candidate ?? options.seed);
        const incoming = product.manifest;
        if (
          incoming.channel !== lane ||
          incoming.identity.appid !== options.manifest.identity.appid ||
          incoming.identity.origin !== options.manifest.identity.origin
        )
          throw new Error("candidate identity mismatch");
        if (current.current !== product.envelope.digest)
          attempt = await capsule.stage(product.envelope, product.assets);
      }
      const mount = attempt ? await capsule.prepare(attempt) : await capsule.mount();
      const manifest = decode(await readFile(join(mount.capsule, "release.json"), "utf8"));
      if (
        manifest.channel !== lane ||
        manifest.identity.appid !== options.manifest.identity.appid ||
        manifest.identity.origin !== options.manifest.identity.origin
      )
        throw new Error("mounted identity mismatch");
      const session = new Session(options, host, factory, capsule, mount, manifest, attempt?.nonce ?? randomUUID());
      session.attempt = attempt;
      return session;
    } catch (fault) {
      if (attempt) await capsule.fail(attempt, String(fault));
      await host.close();
      throw fault;
    }
  }

  async activate(): Promise<Payload> {
    const module = (await import(pathToFileURL(join(this.mount.capsule, "index.mjs")).href)) as {
      activate(context: Context): Promise<Payload>;
    };
    if (typeof module.activate !== "function") throw new Error("capsule activate entry required");
    const payload = await module.activate({
      blobs: this.mount.blobs,
      generation: this.mount.target,
      nonce: this.nonce,
    });
    if (typeof payload.title !== "string" || typeof payload.witness !== "string")
      throw new Error("invalid capsule result");
    return payload;
  }

  async start(): Promise<void> {
    if (this.closed || this.closing || this.lease) throw new Error("session is closed or already started");
    return this.factory.session(() => this.startWithin());
  }

  private async startWithin(): Promise<void> {
    const owner = `n${this.nonce.replaceAll("-", "")}`;
    this.capability = await this.factory.issue({
      owner,
      service: "daemon",
    });
    const data = await this.factory.grant({ kind: "data", name: "daemon", scope: "factory" });
    const socket = await this.factory.grant({ kind: "socket", name: "daemon", owner, scope: "attempt" });
    const port = await this.factory.grant({
      kind: "port",
      name: "daemon",
      owner,
      scope: "attempt",
      scheme: "http",
    });
    this.transient.push(port.lease, socket.lease);
    this.lease = await this.factory.start({
      command: this.options.executable,
      args: [join(this.mount.daemon, "main.mjs")],
      generation: this.mount.target,
      slot: "daemon",
      ready: `ready:${this.mount.target}:${this.nonce}`,
      env: {
        ELECTRON_RUN_AS_NODE: "1",
        PERISH_DATA: data.value,
        PERISH_ORIGIN: this.manifest.identity.origin,
        PERISH_SOCKET: socket.value,
        PERISH_TOKEN: this.capability.token,
        PERISH_GENERATION: this.mount.target,
        PERISH_NONCE: this.nonce,
        PERISH_LIFELINE: "1",
      },
    });
    await this.factory.forward(port.lease, socket.lease);
    this.endpoint = port.value;
    const health = await this.request("health");
    if (health.pid !== this.lease.pid || health.generation !== this.mount.target || health.nonce !== this.nonce) {
      throw new Error("daemon readiness identity mismatch");
    }
  }

  private endpoint = "";
  async request(operation: "health" | "read" | "write", value?: unknown): Promise<Record<string, unknown>> {
    if (this.closed || !this.capability) throw new Error("session is closed or not started");
    const response = await fetch(`${this.endpoint}/${operation === "health" ? "health" : "state"}`, {
      method: operation === "write" ? "PUT" : "GET",
      headers: { authorization: `Bearer ${this.capability.token}`, "content-type": "application/json" },
      body: operation === "write" ? JSON.stringify(value) : undefined,
      signal: AbortSignal.timeout(5000),
    });
    if (response.status === 404 && operation === "read") return {};
    if (!response.ok) throw new Error(`daemon request ${response.status}`);
    return (await response.json()) as Record<string, unknown>;
  }

  async confirm(payload: Payload, renderer: string): Promise<Receipt> {
    return this.factory.session(() => this.confirmWithin(payload, renderer));
  }

  private async confirmWithin(payload: Payload, renderer: string): Promise<Receipt> {
    if (!renderer || !this.lease) throw new Error("runtime evidence missing");
    const daemon = await this.request("health");
    if (daemon.pid !== this.lease.pid || daemon.generation !== this.mount.target || daemon.nonce !== this.nonce) {
      throw new Error("daemon evidence mismatch");
    }
    if (this.attempt) {
      for (const gate of gates) this.attempt = await this.capsule.ready(this.attempt, gate);
      await this.capsule.commit(this.attempt);
      this.attempt = undefined;
    }
    this.ready = true;
    return {
      factory: this.factory.scope,
      directory: await this.factory.directory(),
      capsule: payload.witness,
      daemon,
      generation: this.mount.target,
      nonce: this.nonce,
      pid: process.pid,
      renderer,
      schema: 1,
    };
  }

  async close(error = "runtime stopped before readiness"): Promise<{ status: string; survivors: number[] }> {
    if (this.closed) return { status: "stopped", survivors: [] };
    this.closing ??= this.closeWithin(error).finally(() => {
      this.closing = undefined;
    });
    return this.closing;
  }

  private async closeWithin(error: string): Promise<{ status: string; survivors: number[] }> {
    let result = { status: "stopped", survivors: [] as number[] };
    await this.factory.session(async () => {
      if (this.attempt && !this.ready) {
        await this.capsule.fail(this.attempt, error);
        this.attempt = undefined;
      }
      if (this.lease) result = await this.factory.release(this.lease);
      if (result.status !== "stopped" || result.survivors.length) throw new Error("daemon retirement incomplete");
      if (this.capability) await this.factory.retire(this.capability);
      for (const lease of this.transient) await this.factory.revoke(lease);
    });
    await this.host.close();
    this.closed = true;
    return result;
  }
}
