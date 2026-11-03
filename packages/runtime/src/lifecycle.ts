import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Digest } from "@perishcode/protocol";
import type { Attachment, Context, Expose, Factory, Identity } from "@perishcode/sidecar";
import type { Mount } from "./generations.js";

export interface Composition {
  window: { title: string };
  witness: string;
}
export interface CapsuleContext {
  readonly blobs: Readonly<Record<string, string>>;
  readonly generation: Digest;
  readonly nonce: string;
  readonly resources: Context;
}
/** Each create() returns a fresh product body. stop must cancel and drain its work. */
export interface Capsule<M = Record<string, { input: unknown; output: unknown }>> {
  handlers: Expose<M>["handlers"];
  initialize(context: CapsuleContext): Promise<Composition>;
  stop(): Promise<void>;
}
export interface ProductReceipt {
  identity: Readonly<Identity>;
  incarnation: string;
}

/** Stable host owns the attachment; product code receives only scoped resources. */
export class Product {
  private body?: Capsule;
  private attachment?: Attachment;
  private context?: Context;
  private composition?: Composition;
  private phase: "initializing" | "ready" | "stopping" | "failed" | "stopped" = "initializing";
  constructor(
    private factory: Factory,
    private mount: Mount,
    private nonce: string,
    private generation: Digest,
  ) {}

  async initialize(): Promise<Composition> {
    const handlers: Expose<Record<string, { input: unknown; output: unknown }>>["handlers"] = {};
    this.attachment = await this.factory.expose<Record<string, { input: unknown; output: unknown }>>({
      identity: { service: "capsule", generation: this.generation },
      handlers,
      lifecycle: {
        initialize: async (resources) => {
          this.context = resources;
          try {
            const module = await import(pathToFileURL(join(this.mount.capsule, "index.mjs")).href);
            if (typeof module.create !== "function") throw new Error("capsule create entry required");
            const body = module.create() as Capsule;
            if (
              !body ||
              typeof body.initialize !== "function" ||
              typeof body.stop !== "function" ||
              !body.handlers ||
              typeof body.handlers !== "object" ||
              Array.isArray(body.handlers) ||
              Object.values(body.handlers).some((handler) => typeof handler !== "function")
            )
              throw new Error("invalid capsule lifecycle");
            this.body = body;
            Object.assign(handlers, body.handlers);
            const composition = await body.initialize(
              Object.freeze({
                blobs: Object.freeze({ ...this.mount.blobs }),
                generation: this.mount.target,
                nonce: this.nonce,
                resources,
              }),
            );
            if (
              typeof composition?.window?.title !== "string" ||
              !composition.window.title ||
              typeof composition.witness !== "string" ||
              !composition.witness
            )
              throw new Error("invalid capsule composition");
            this.composition = Object.freeze({
              window: Object.freeze({ title: composition.window.title }),
              witness: composition.witness,
            });
            this.phase = "ready";
          } catch (error) {
            this.phase = "failed";
            throw error;
          }
        },
        stop: async () => {
          this.phase = "stopping";
          try {
            await this.body?.stop();
            this.phase = "stopped";
          } catch (error) {
            this.phase = "failed";
            throw error;
          }
        },
      },
    });
    this.assertReady();
    return this.composition!;
  }
  assertReady(): void {
    if (this.phase !== "ready") throw new Error("capsule is not ready");
  }
  snapshot(): ProductReceipt | undefined {
    return this.context && { identity: this.context.identity, incarnation: this.context.incarnation };
  }
  async close(): Promise<void> {
    await this.attachment?.close();
  }
}
