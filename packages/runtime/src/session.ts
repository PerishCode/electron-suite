import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { channel, type Digest, type Generation, gates, namespace } from "@perishcode/protocol";
import type { Release } from "@perishcode/publish";
import { decode, type Manifest } from "@perishcode/release";
import {
  Client,
  type Directory,
  type Expose,
  type Factory,
  type FactoryScope,
  type Service,
  serve,
} from "@perishcode/sidecar";
import { Agent } from "./agent.js";
import { type Attempt, Capsule, type Mount } from "./capsule.js";
import { readProduct } from "./product.js";
import { leaf, unitFile } from "./units.js";

export interface Context {
  blobs: Record<string, string>;
  generation: Digest;
  nonce: string;
}
export interface Payload {
  title: string;
  witness: string;
}
export interface ActivationCheckpoint {
  stage: "prepared" | "daemon-stopped" | "ready" | "committed";
  target: Digest;
  nonce: string;
  previous: Digest;
}
export interface SessionOptions {
  /** Diagnostic observation only; never substitutes for runtime readiness. */
  onActivation?: (checkpoint: Readonly<ActivationCheckpoint>) => Promise<void>;
  carrier: number;
  candidate?: string;
  executable: string;
  manifest: Manifest;
  namespace: string;
  recover?: boolean;
  root: string;
  seed: string;
}
export interface Renderer {
  reload(): Promise<string>;
  probe(): Promise<string>;
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
  anchor: Digest;
  phase: string;
  error?: string;
  candidate?: Digest;
  units: {
    web: { digest?: Digest; version?: string; generation: Digest; nonce: string };
    daemon: { digest?: Digest; version?: string; nonce?: string; pid?: number; phase?: string };
  };
  counts: { daemon: number; document: number };
}
export class Session {
  private attempt?: Attempt;
  private agent?: Agent;
  private closed = false;
  private closing?: Promise<{ status: string; survivors: number[] }>;
  private ready = false;
  private payload?: Payload;
  private witness = "";
  private current: Mount;
  private view: Mount;
  private viewGeneration?: Generation;
  readonly anchor: Digest;
  private docGeneration: Digest;
  private docNonce: string;
  private documents = 0;
  private starts = 0;
  private webVersion?: string;
  private phase = "starting";
  private error?: string;
  private target?: Digest;
  get mount() {
    return this.view;
  }
  private constructor(
    readonly options: SessionOptions,
    private host: Service,
    private factory: Factory,
    private capsule: Capsule,
    mount: Mount,
    readonly manifest: Manifest,
    readonly nonce: string,
  ) {
    this.current = mount;
    this.view = mount;
    this.anchor = mount.target;
    this.docGeneration = mount.target;
    this.docNonce = nonce;
  }
  content() {
    if (this.closed || this.closing) throw new Error("session is closed");
    return this.capsule.content(this.current.target);
  }
  async expose<M>(service: string, options: Omit<Expose<M>, "identity">) {
    if (this.closed || this.closing) throw new Error("session is closed");
    return this.host.factory(this.factory.scope).expose({ ...options, identity: { service, generation: this.anchor } });
  }
  documentStart() {
    this.docGeneration = this.view.target;
    this.docNonce = this.documents === 0 ? this.nonce : randomUUID();
    this.documents++;
    this.witness = "";
  }
  browser() {
    return {
      generation: this.docGeneration,
      nonce: this.docNonce,
      version: this.manifest.identity.version,
      web: { unit: this.viewGeneration?.web.digest, version: this.webVersion },
      daemon: {
        generation: this.agent?.generation,
        nonce: this.agent?.nonce,
        unit: this.agent?.unit,
        version: this.agent?.version,
      },
    };
  }
  documentNonce() {
    return this.docNonce;
  }
  webURL() {
    if (!this.viewGeneration) throw new Error("web content is not mounted");
    return `${this.manifest.identity.origin}/_web/${this.viewGeneration.web.digest.slice(7)}/`;
  }
  static async open(options: SessionOptions): Promise<Session> {
    await mkdir(options.root, { recursive: true, mode: 0o700 });
    // The Electron adapter holds an OS single-instance lock for this root.
    const key = createHash("sha256").update(options.root).digest("hex").slice(0, 20);
    const endpoint = join(tmpdir(), `pesuite-${key}-${process.pid}.sock`);
    const host = await serve(endpoint, { root: options.root });
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
    this.payload = payload;
    return payload;
  }

  async start(): Promise<void> {
    if (this.closed || this.closing || this.agent) throw new Error("session is closed or already started");
    await this.factory.session(async () => {
      this.viewGeneration = (await this.content()).envelope.generation;
      this.webVersion = (await unitFile(this.view.web, "web"))?.version;
      const web = await unitFile(this.view.web, "web"),
        daemon = await unitFile(this.view.daemon, "daemon");
      if (!!web !== !!daemon || (web && daemon && web.api !== daemon.api))
        throw new Error("incompatible initial unit contracts");
      await this.launch(this.current, this.viewGeneration, this.nonce);
    });
  }
  private async launch(mount: Mount, generation: Generation, nonce?: string) {
    this.agent = await Agent.start(
      this.factory,
      mount,
      generation.daemon.digest,
      this.options.executable,
      this.manifest.identity.origin,
      nonce,
    );
    this.starts++;
  }
  async request(operation: "health" | "read" | "write", value?: unknown) {
    if (this.closed || !this.agent) throw new Error("session is closed or not started");
    return this.agent.request(operation, value);
  }
  async confirm(payload: Payload, renderer: string): Promise<Receipt> {
    return this.factory.session(async () => {
      if (!renderer || !this.agent) throw new Error("runtime evidence missing");
      this.agent.exact(await this.agent.request("health"));
      this.payload = payload;
      this.witness = renderer;
      if (this.attempt) {
        for (const gate of gates) this.attempt = await this.capsule.ready(this.attempt, gate);
        await this.capsule.commit(this.attempt);
        this.attempt = undefined;
      }
      this.ready = true;
      this.phase = "ready";
      return this.snapshot();
    });
  }
  async snapshot(): Promise<Receipt> {
    let daemon: Record<string, unknown> = {
      pid: this.agent?.pid,
      generation: this.agent?.generation,
      nonce: this.agent?.nonce,
      phase: this.agent?.phase,
    };
    if (this.agent?.phase === "ready") {
      try {
        daemon = await this.agent.request("health");
      } catch (error) {
        daemon.error = String(error);
      }
    }
    const web = await unitFile(this.view.web, "web");
    return {
      schema: 1,
      factory: this.factory.scope,
      directory: await this.factory.directory(),
      generation: this.current.target,
      nonce: this.nonce,
      anchor: this.anchor,
      phase: this.phase,
      error: this.error,
      candidate: this.target,
      capsule: this.payload?.witness ?? "",
      daemon,
      renderer: this.witness,
      pid: process.pid,
      units: {
        web: {
          digest: this.viewGeneration?.web.digest,
          version: web?.version,
          generation: this.docGeneration,
          nonce: this.docNonce,
        },
        daemon: {
          digest: this.agent?.unit,
          version: this.agent?.version,
          nonce: this.agent?.nonce,
          pid: this.agent?.pid,
          phase: this.agent?.phase,
        },
      },
      counts: { daemon: this.starts, document: this.documents },
    };
  }
  async applyLeaf(release: Release, renderer: Renderer): Promise<Receipt> {
    if (this.closed || this.closing || !this.ready || this.phase !== "ready")
      throw new Error("runtime is not accepting leaf activation");
    return this.factory.session(async () => {
      if (this.phase !== "ready") throw new Error("runtime is not accepting leaf activation");
      const before = await this.content(),
        plan = leaf(before, release, this.factory.scope.channel);
      const old = this.current;
      let daemonTouched = false,
        webTouched = false,
        committing = false;
      this.phase = "preparing";
      this.target = release.envelope.digest;
      this.error = undefined;
      try {
        this.attempt = await this.capsule.stage(release.envelope, release.assets);
        const next = await this.capsule.prepare(this.attempt);
        await this.checkpoint("prepared");
        this.phase = "activating";
        if (plan.changed.includes("web")) {
          this.docNonce = randomUUID();
          this.witness = "";
          webTouched = true;
        }
        if (plan.changed.includes("daemon")) {
          daemonTouched = true;
          await this.agent?.close();
          this.agent = undefined;
          await this.checkpoint("daemon-stopped");
          await this.launch(next, release.envelope.generation);
        }
        this.view = next;
        this.viewGeneration = release.envelope.generation;
        this.webVersion = plan.next.web.version;
        if (plan.changed.includes("web")) {
          webTouched = true;
          this.witness = await renderer.reload();
        } else this.witness = await renderer.probe();
        if (!this.witness || !this.agent) throw new Error("leaf renderer evidence missing");
        this.agent.exact(await this.agent.request("health"));
        for (const gate of gates) this.attempt = await this.capsule.ready(this.attempt, gate);
        await this.checkpoint("ready");
        committing = true;
        await this.capsule.commit(this.attempt);
        await this.checkpoint("committed");
        this.attempt = undefined;
        this.current = next;
        this.phase = "ready";
        this.target = undefined;
      } catch (error) {
        this.error = String(error);
        this.phase = "failed";
        if (committing) {
          const binding = await this.factory.binding();
          if (binding.state.current === release.envelope.digest && !binding.state.attempt) {
            this.current = this.view;
            this.attempt = undefined;
            throw new Error(`leaf commit persisted; cleanup failed: ${this.error}`);
          }
        }
        let restored = false;
        try {
          this.view = old;
          this.viewGeneration = before.envelope.generation;
          this.webVersion = (await unitFile(old.web, "web"))?.version;
          if (daemonTouched) {
            await this.agent?.close();
            this.agent = undefined;
            await this.launch(old, before.envelope.generation);
          }
          this.witness = webTouched ? await renderer.reload() : await renderer.probe();
          this.agent?.exact(await this.request("health"));
          restored = !!this.witness;
        } catch (rollback) {
          this.error += `; rollback: ${String(rollback)}`;
        }
        if (this.attempt) {
          await this.capsule.fail(this.attempt, this.error);
          this.attempt = undefined;
        }
        throw new Error(`leaf activation failed; baseline restored=${restored}: ${this.error}`);
      }
      return this.snapshot();
    });
  }
  private async checkpoint(stage: ActivationCheckpoint["stage"]) {
    if (!this.attempt) throw new Error("activation attempt missing");
    await this.options.onActivation?.(
      Object.freeze({
        stage,
        target: this.attempt.target,
        nonce: this.attempt.nonce,
        previous: this.current.target,
      }),
    );
  }
  async close(error = "runtime stopped before readiness"): Promise<{ status: string; survivors: number[] }> {
    if (this.closed) return { status: "stopped", survivors: [] };
    this.closing ??= this.closeWithin(error).finally(() => {
      this.closing = undefined;
    });
    return this.closing;
  }
  private async closeWithin(error: string) {
    await this.factory.session(async () => {
      if (this.attempt && !this.ready) {
        await this.capsule.fail(this.attempt, error);
        this.attempt = undefined;
      }
      await this.agent?.close();
    });
    await this.host.close();
    this.closed = true;
    this.phase = "stopped";
    return { status: "stopped", survivors: [] as number[] };
  }
}
