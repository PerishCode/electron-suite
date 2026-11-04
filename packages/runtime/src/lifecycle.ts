import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Digest } from "@perishcode/protocol";
import type { Context } from "@perishcode/sidecar";
import type { Mount } from "./generations.js";

export interface Composition {
  window: { title: string };
  loading: string;
  witness: string;
}
export interface CapsuleEnvironment {
  updates?: () => Promise<{ close(): Promise<void> }>;
}
export interface CapsuleContext {
  readonly blobs: Readonly<Record<string, string>>;
  readonly generation: Digest;
  readonly nonce: string;
  readonly protocols: Readonly<{ internal: string; external: string; origin: string }>;
  /** Context of the real Electron owner; Capsule has no sidecar identity. */
  readonly resources: Context;
  readonly daemon: {
    request(operation: "health" | "read" | "write", value?: unknown): Promise<Record<string, unknown>>;
  };
  readonly updates: { start(): Promise<void>; stop(): Promise<void> };
}
export interface Capsule {
  handlers: Record<string, (input: unknown, context: CapsuleContext) => unknown | Promise<unknown>>;
  initialize(context: CapsuleContext): Promise<Composition>;
  ready(): Promise<void>;
  stop(): Promise<void>;
}
export interface ProductReceipt {
  artifact: Digest;
}

/** Loaded adapter code. The stable Electron owner retains all system resources. */
export class Product {
  private body?: Capsule;
  private phase: "initializing" | "ready" | "stopping" | "failed" | "stopped" = "initializing";
  private calls = new Set<Promise<unknown>>();
  private updater?: { close(): Promise<void> };
  private updaterStart?: Promise<void>;
  private context: CapsuleContext;
  constructor(
    resources: Context,
    private mount: Mount,
    nonce: string,
    private artifact: Digest,
    daemon: CapsuleContext["daemon"],
    environment: CapsuleEnvironment,
    protocols: CapsuleContext["protocols"],
  ) {
    this.context = Object.freeze({
      blobs: Object.freeze({ ...mount.blobs }),
      generation: mount.target,
      nonce,
      resources,
      protocols,
      daemon,
      updates: Object.freeze({ start: () => this.startUpdates(environment), stop: () => this.stopUpdates() }),
    });
  }
  private startUpdates(environment: CapsuleEnvironment): Promise<void> {
    this.assertReady();
    this.updaterStart ??= (async () => {
      this.updater = await environment.updates?.();
    })();
    return this.updaterStart;
  }
  private async stopUpdates() {
    await this.updaterStart;
    await this.updater?.close();
    this.updater = undefined;
  }
  async initialize(): Promise<Composition> {
    try {
      const module = await import(pathToFileURL(join(this.mount.capsule, "index.mjs")).href);
      if (typeof module.create !== "function") throw new Error("capsule create entry required");
      const body = module.create() as Capsule;
      if (
        !body ||
        typeof body.initialize !== "function" ||
        typeof body.ready !== "function" ||
        typeof body.stop !== "function" ||
        !body.handlers ||
        typeof body.handlers !== "object" ||
        Array.isArray(body.handlers) ||
        Object.values(body.handlers).some((handler) => typeof handler !== "function")
      )
        throw new Error("invalid capsule adapter");
      this.body = body;
      const composition = await body.initialize(this.context);
      if (
        typeof composition?.window?.title !== "string" ||
        !composition.window.title ||
        typeof composition.loading !== "string" ||
        !composition.loading ||
        typeof composition.witness !== "string" ||
        !composition.witness
      )
        throw new Error("invalid capsule composition");
      this.phase = "ready";
      return Object.freeze({
        window: Object.freeze({ title: composition.window.title }),
        loading: composition.loading,
        witness: composition.witness,
      });
    } catch (error) {
      this.phase = "failed";
      throw error;
    }
  }
  assertReady() {
    if (this.phase !== "ready") throw new Error("capsule is not ready");
  }
  async ready() {
    this.assertReady();
    await this.body!.ready();
  }
  call(method: string, input: unknown): Promise<unknown> {
    this.assertReady();
    if (!Object.hasOwn(this.body!.handlers, method)) return Promise.reject(new Error("unknown capsule method"));
    const pending = Promise.resolve().then(() => this.body!.handlers[method]!(input, this.context));
    this.calls.add(pending);
    return pending.finally(() => this.calls.delete(pending));
  }
  snapshot(): ProductReceipt {
    return { artifact: this.artifact };
  }
  async close(): Promise<void> {
    if (this.phase === "stopped") return;
    this.phase = "stopping";
    try {
      await Promise.allSettled([...this.calls]);
      await this.body?.stop();
      await this.stopUpdates();
      this.phase = "stopped";
    } catch (error) {
      this.phase = "failed";
      throw error;
    }
  }
}
