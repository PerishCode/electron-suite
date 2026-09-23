import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  canonical,
  channel,
  gates,
  namespace,
  reduce,
  valid,
  type Binding,
  type Channel,
  type Digest,
  type Event,
  type Fault,
  type Namespace,
} from "@perish/protocol";

export interface Journal {
  revision: number;
  state: Binding;
}

export type Change =
  | { changed: boolean; journal: Journal; ok: true }
  | { fault: Fault | "revision"; journal: Journal; ok: false };

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function target(value: unknown, name: string): Digest {
  if (typeof value !== "string" || !valid(value)) throw new TypeError(`${name} is invalid`);
  return value;
}

function parse(value: unknown, scope: Namespace, lane: Channel): Journal {
  const data = record(value, "journal");
  const state = record(data.state, "journal.state");
  if (!Number.isSafeInteger(data.revision) || Number(data.revision) < 0) {
    throw new TypeError("journal.revision is invalid");
  }
  if (channel(String(state.channel)) !== lane || namespace(String(state.namespace)) !== scope) {
    throw new TypeError("journal identity mismatch");
  }
  const binding: Binding = { channel: lane, namespace: scope };
  if (state.current !== undefined) binding.current = target(state.current, "binding.current");
  if (state.handoff !== undefined) {
    const handoff = record(state.handoff, "binding.handoff");
    if (handoff.mode !== "update" && handoff.mode !== "recovery") {
      throw new TypeError("binding.handoff.mode is invalid");
    }
    binding.handoff = {
      mode: handoff.mode,
      target: target(handoff.target, "binding.handoff.target"),
    };
  }
  if (state.attempt !== undefined) binding.attempt = attempt(state.attempt);
  if (binding.attempt && binding.handoff?.target !== binding.attempt.target) {
    throw new TypeError("binding attempt is detached");
  }
  return { revision: data.revision as number, state: binding };
}

function attempt(value: unknown): NonNullable<Binding["attempt"]> {
  const data = record(value, "binding.attempt");
  if (typeof data.nonce !== "string" || !data.nonce) throw new TypeError("binding.attempt.nonce is invalid");
  if (data.status !== "running" && data.status !== "failed") {
    throw new TypeError("binding.attempt.status is invalid");
  }
  const values = data.ready;
  if (!Array.isArray(values) || values.some((gate) => !gates.includes(gate))) {
    throw new TypeError("binding.attempt.ready is invalid");
  }
  const ready = gates.filter((gate) => values.includes(gate));
  if (ready.length !== values.length) throw new TypeError("binding.attempt.ready is invalid");
  const result: NonNullable<Binding["attempt"]> = {
    nonce: data.nonce,
    ready,
    status: data.status,
    target: target(data.target, "binding.attempt.target"),
  };
  if (data.error !== undefined) {
    if (typeof data.error !== "string" || !data.error) throw new TypeError("binding.attempt.error is invalid");
    result.error = data.error;
  }
  return result;
}

export class Bindings {
  readonly #root: string;
  readonly #pending = new Map<string, Promise<void>>();

  constructor(root: string) {
    this.#root = resolve(root, "bindings");
  }

  read(scope: Namespace, lane: Channel): Promise<Journal> {
    return this.#run(scope, lane, () => this.#load(scope, lane));
  }

  transit(scope: Namespace, lane: Channel, revision: number, event: Event): Promise<Change> {
    return this.#run(scope, lane, async () => {
      const journal = await this.#load(scope, lane);
      if (journal.revision !== revision) return { fault: "revision", journal, ok: false };
      const transition = reduce(journal.state, event);
      if (!transition.ok) return { fault: transition.fault, journal, ok: false };
      if (!transition.changed) return { changed: false, journal, ok: true };
      const next = { revision: revision + 1, state: transition.state };
      await this.#save(scope, lane, next);
      return { changed: true, journal: next, ok: true };
    });
  }

  async #load(scope: Namespace, lane: Channel): Promise<Journal> {
    try {
      return parse(JSON.parse(await readFile(this.#path(scope, lane), "utf8")), scope, lane);
    } catch (fault) {
      if ((fault as NodeJS.ErrnoException).code !== "ENOENT") throw fault;
      return { revision: 0, state: { channel: lane, namespace: scope } };
    }
  }

  #path(scope: Namespace, lane: Channel): string {
    return join(this.#root, lane, `${scope}.json`);
  }

  #run<T>(scope: Namespace, lane: Channel, action: () => Promise<T>): Promise<T> {
    const identity = `${lane}:${scope}`;
    const prior = this.#pending.get(identity) ?? Promise.resolve();
    const result = prior.then(action, action);
    const pending = result.then(() => undefined, () => undefined);
    this.#pending.set(identity, pending);
    pending.finally(() => {
      if (this.#pending.get(identity) === pending) this.#pending.delete(identity);
    });
    return result;
  }

  async #save(scope: Namespace, lane: Channel, journal: Journal): Promise<void> {
    const root = join(this.#root, lane);
    const path = this.#path(scope, lane);
    const temporary = `${path}.tmp`;
    await mkdir(root, { mode: 0o700, recursive: true });
    await writeFile(temporary, `${canonical(journal)}\n`, { mode: 0o600 });
    await rename(temporary, path);
  }
}
