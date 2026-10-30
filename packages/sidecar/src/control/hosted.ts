import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { digest, type Grant } from "@perishcode/protocol";
import type { Catalog } from "../runtime/catalog.js";
import type { Resources } from "../runtime/resource.js";
import {
  type Attachment,
  type Context,
  type Descriptor,
  descriptor,
  type Expose,
  type Identity,
  identity,
} from "./types.js";

interface Entry {
  capability: Descriptor;
  context?: Context;
  phase: "initializing" | "ready" | "stopping" | "failed";
  calls: Set<Promise<unknown>>;
  close(): Promise<void>;
}
const key = (value: Identity): string => {
  const scope = identity(value);
  return JSON.stringify([scope.namespace, scope.channel, scope.service]);
};
const equal = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

export class Hosted {
  private entries = new Map<string, Entry>();
  private closing = false;
  constructor(
    private open: (namespace: string) => Promise<Resources>,
    private catalog?: Catalog,
  ) {}

  async expose<M>(options: Expose<M>): Promise<Attachment> {
    if (this.closing) throw new Error("host is closing");
    const scope = Object.freeze(identity(options.identity));
    const id = key(scope);
    if (this.entries.has(id)) throw new Error("service already owned");
    const incarnation = randomUUID();
    let resolveClosed: () => void = () => {};
    const closed = new Promise<void>((done) => {
      resolveClosed = done;
    });
    let stopping: Promise<void> | undefined;
    let claimed = false;
    let resources: Resources | undefined;
    let temporary: string | undefined;
    const grants = new Map<string, Grant>();
    const allocations = new Set<Promise<unknown>>();
    let initialized: () => void = () => {};
    const initialization = new Promise<void>((done) => {
      initialized = done;
    });
    const entry: Entry = {
      capability: { ...scope, incarnation, token: randomBytes(32).toString("hex") },
      phase: "initializing",
      calls: new Set(),
      close: () => {
        if (stopping) return stopping;
        entry.phase = "stopping";
        stopping = (async () => {
          this.catalog?.change(scope, incarnation, "stopping");
          await initialization;
          await Promise.allSettled([...entry.calls]);
          await Promise.allSettled([...allocations]);
          await options.lifecycle.stop();
          for (const [value, grant] of grants) {
            await resources?.release(grant.lease, []);
            grants.delete(value);
          }
          if (resources && temporary) {
            await resources.release(temporary, []);
            temporary = undefined;
          }
          this.catalog?.change(scope, incarnation, "retired");
          if (this.entries.get(id) === entry) this.entries.delete(id);
          resolveClosed();
        })().catch((fault) => {
          entry.phase = "failed";
          stopping = undefined;
          if (claimed) this.catalog?.change(scope, incarnation, "failed");
          throw fault;
        });
        return stopping;
      },
    };
    this.entries.set(id, entry);
    try {
      this.catalog?.claim(scope, incarnation, "hosted");
      claimed = true;
      resources = await this.open(scope.namespace);
      const name = `h${digest(`${scope.channel}:${scope.service}`).slice(7, 31)}`;
      const data = await resources.grant({ kind: "data", name, scope: "namespace" });
      const logs = await resources.grant({ kind: "logs", name, scope: "namespace" });
      const resource = await resources.grant({ kind: "cache", name, scope: "namespace" });
      const runtime = await resources.grant({ kind: "staging", name, owner: incarnation, scope: "attempt" });
      temporary = runtime.lease;
      const context: Context = Object.freeze({
        identity: scope,
        incarnation,
        roots: Object.freeze({ data: data.value, logs: logs.value, resource: resource.value, runtime: runtime.value }),
        allocate: (request: { kind: "port" | "socket" | "lock"; name: string; scheme?: "http" | "tcp" }) => {
          if (!["initializing", "ready"].includes(entry.phase))
            return Promise.reject(new Error("service is not allocating"));
          if (!["port", "socket", "lock"].includes(request.kind) || !/^[a-z][a-z0-9]*$/.test(request.name)) {
            return Promise.reject(new Error("invalid service resource"));
          }
          const pending = (async () => {
            const grant = await (resources as Resources).grant({
              ...request,
              name: `h${digest(`${scope.channel}:${scope.service}:${request.name}`).slice(7, 31)}`,
              scope: "attempt",
              owner: incarnation,
            });
            grants.set(grant.value, grant);
            return { kind: grant.kind, value: grant.value };
          })();
          allocations.add(pending);
          void pending.finally(() => allocations.delete(pending)).catch(() => {});
          return pending;
        },
        forward: async (port: string, socket: string) => {
          if (!["initializing", "ready"].includes(entry.phase)) throw new Error("service is not forwarding");
          const p = grants.get(port);
          const s = grants.get(socket);
          if (p?.kind !== "port" || s?.kind !== "socket") throw new Error("service resource ownership mismatch");
          const pending = (resources as Resources).forward(p.lease, s.lease);
          allocations.add(pending);
          try {
            await pending;
          } finally {
            allocations.delete(pending);
          }
        },
      });
      entry.context = context;
      await options.lifecycle.initialize(context);
      initialized();
      if (entry.phase !== "initializing") {
        await entry.close();
        throw new Error("service stopped during initialization");
      }
      this.catalog?.change(scope, incarnation, "ready");
      entry.phase = "ready";
      this.handlers.set(
        entry,
        Object.freeze({ ...options.handlers }) as Record<string, (input: unknown, context: Context) => unknown>,
      );
      return { context, closed, close: entry.close };
    } catch (fault) {
      initialized();
      if (!claimed) {
        this.entries.delete(id);
        resolveClosed();
        throw fault;
      }
      try {
        await entry.close();
      } catch (cleanup) {
        throw new AggregateError([fault, cleanup], "initialization and drain failed; service remains owned");
      }
      throw fault;
    }
  }

  private handlers = new WeakMap<Entry, Record<string, (input: unknown, context: Context) => unknown>>();
  connect(input: Identity): Descriptor {
    const entry = this.entries.get(key(input));
    if (entry?.phase !== "ready" || entry.capability.generation !== input.generation)
      throw new Error("service is not ready");
    return { ...entry.capability };
  }
  async invoke(input: Descriptor, operation: string, method?: string, value?: unknown): Promise<unknown> {
    const capability = descriptor(input);
    const entry = this.entries.get(key(capability));
    if (
      !entry ||
      entry.capability.incarnation !== capability.incarnation ||
      !equal(entry.capability.token, capability.token)
    ) {
      throw new Error("service capability is fenced");
    }
    if (operation === "stop") {
      await entry.close();
      return null;
    }
    if (operation === "probe")
      return { identity: identity(entry.capability), incarnation: entry.capability.incarnation, phase: entry.phase };
    if (entry.phase !== "ready" || !entry.context) throw new Error("service is not ready");
    const handlers = this.handlers.get(entry);
    if (!method || !handlers || !Object.hasOwn(handlers, method)) throw new Error("unknown service method");
    const handler = handlers[method];
    if (!handler) throw new Error("unknown service method");
    const pending = Promise.resolve().then(() => handler(value, entry.context as Context));
    entry.calls.add(pending);
    try {
      return await pending;
    } finally {
      entry.calls.delete(pending);
    }
  }
  async close(): Promise<void> {
    this.closing = true;
    const results = await Promise.allSettled([...this.entries.values()].map((entry) => entry.close()));
    const errors = results.filter((r) => r.status === "rejected").map((r) => r.reason);
    if (errors.length) {
      throw new AggregateError(errors, "hosted services did not drain");
    }
  }
}
