import { randomBytes, randomUUID } from "node:crypto";

import {
  canonical,
  channel,
  digest,
  namespace,
  type Channel,
  type Digest,
  type Namespace,
  valid,
} from "@perish/protocol";

import { launch, type Launch, type Running, type Stop } from "./runner.js";

export interface Spec extends Launch {
  channel: Channel;
  generation: Digest;
  namespace: Namespace;
  slot: string;
}

export interface Lease {
  attachment: string;
  capability: string;
  channel: Channel;
  generation: Digest;
  namespace: Namespace;
  pid: number;
  slot: string;
}

export interface Snapshot {
  attachments: number;
  channel: Channel;
  generation: Digest;
  namespace: Namespace;
  pid: number;
  slot: string;
  state: "running" | "exited";
}

export interface Release {
  status: "retained" | Stop["status"];
  survivors: number[];
}

interface Entry {
  attachments: Map<string, string>;
  channel: Channel;
  fingerprint: Digest;
  generation: Digest;
  namespace: Namespace;
  running: Running;
  slot: string;
}

interface Retired {
  capability: string;
  result: Release;
}

function fingerprint(spec: Spec): Digest {
  return digest(canonical({
    args: spec.args ?? [],
    command: spec.command,
    cwd: spec.cwd ?? process.cwd(),
    env: spec.env ?? {},
    grace: spec.grace ?? 1000,
    ready: spec.ready,
    timeout: spec.timeout ?? 5000,
  }));
}

function key(value: Pick<Spec, "channel" | "generation" | "namespace" | "slot">): string {
  return [value.namespace, value.channel, value.slot, value.generation].join(":");
}

function lease(entry: Entry): Lease {
  const attachment = randomUUID();
  const capability = randomBytes(32).toString("base64url");
  entry.attachments.set(attachment, capability);

  return {
    attachment,
    capability,
    channel: entry.channel,
    generation: entry.generation,
    namespace: entry.namespace,
    pid: entry.running.pid,
    slot: entry.slot,
  };
}

export class Sidecar {
  readonly #entries = new Map<string, Promise<Entry>>();
  readonly #released = new Map<string, Retired>();

  #discard(identity: string, pending: Promise<Entry>): void {
    if (this.#entries.get(identity) === pending) this.#entries.delete(identity);
  }

  async #create(spec: Spec, mark: Digest): Promise<Entry> {
    const running = await launch(spec);

    return {
      attachments: new Map(),
      channel: spec.channel,
      fingerprint: mark,
      generation: spec.generation,
      namespace: spec.namespace,
      running,
      slot: spec.slot,
    };
  }

  async start(spec: Spec): Promise<Lease> {
    if (!valid(spec.generation)) throw new TypeError("invalid generation");
    channel(spec.channel);
    namespace(spec.namespace);
    if (!/^[a-z][a-z0-9]*$/.test(spec.slot)) throw new TypeError("invalid slot");
    const mark = fingerprint(spec);
    const identity = key(spec);
    let pending = this.#entries.get(identity);

    if (!pending) {
      const created = this.#create(spec, mark);
      pending = created;
      this.#entries.set(identity, created);
      created.catch(() => this.#discard(identity, created));
    }

    const entry = await pending;
    if (entry.fingerprint !== mark) throw new Error("generation config mismatch");
    if (!entry.running.active()) throw new Error("generation process exited");
    return lease(entry);
  }

  async attach(value: Lease): Promise<Lease> {
    const pending = this.#entries.get(key(value));
    if (!pending) throw new Error("generation unavailable");
    const entry = await pending;

    if (entry.attachments.get(value.attachment) !== value.capability) {
      throw new Error("invalid capability");
    }

    if (!entry.running.active()) throw new Error("generation process exited");
    return lease(entry);
  }

  async release(value: Lease): Promise<Release> {
    const prior = this.#released.get(value.attachment);
    if (prior && prior.capability !== value.capability) throw new Error("invalid capability");
    if (prior) return prior.result;
    const identity = key(value);
    const pending = this.#entries.get(identity);
    if (!pending) throw new Error("generation unavailable");
    const entry = await pending;

    if (entry.attachments.get(value.attachment) !== value.capability) {
      throw new Error("invalid capability");
    }

    if (!entry.attachments.delete(value.attachment)) throw new Error("invalid attachment");

    if (entry.attachments.size > 0) {
      const result: Release = { status: "retained", survivors: [] };
      this.#released.set(value.attachment, { capability: value.capability, result });
      return result;
    }

    const result = await entry.running.stop();
    const release: Release = result;
    this.#released.set(value.attachment, { capability: value.capability, result: release });

    if (result.status === "stopped") {
      this.#entries.delete(identity);
    }

    return release;
  }

  async inspect(): Promise<Snapshot[]> {
    const entries = await Promise.all(this.#entries.values());

    return entries.map((entry) => ({
      attachments: entry.attachments.size,
      channel: entry.channel,
      generation: entry.generation,
      namespace: entry.namespace,
      pid: entry.running.pid,
      slot: entry.slot,
      state: entry.running.active() ? "running" : "exited",
    }));
  }

  async close(): Promise<Stop[]> {
    const entries = await Promise.all(this.#entries.values());
    const results = await Promise.all(entries.map((entry) => entry.running.stop()));

    for (const [identity, pending] of this.#entries) {
      const entry = await pending;
      if (!entry.running.active()) this.#entries.delete(identity);
    }

    return results;
  }
}
