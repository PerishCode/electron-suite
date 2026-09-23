import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

import { Store } from "@perish/blob";
import {
  envelope,
  gates,
  canonical,
  startup,
  verify,
  type Artifact,
  type Channel,
  type Digest,
  type Envelope,
  type Gate,
  type Mode,
  type Namespace,
} from "@perish/protocol";
import { Feed } from "@perish/publish";
import { bundle, materialize } from "@perish/release";
import { type Change, Client, type Journal } from "@perish/sidecar";

export interface Content {
  artifact: Artifact;
  bytes: string | Uint8Array;
}

export interface Attempt {
  channel: Channel;
  lease: string;
  namespace: Namespace;
  nonce: string;
  revision: number;
  target: Digest;
}

export interface Mount {
  blobs: Record<string, string>;
  capsule: string;
  daemon: string;
  target: Digest;
  web: string;
}

function list(value: Envelope): Artifact[] {
  const generation = value.generation;
  return [generation.capsule, generation.daemon, generation.web, ...generation.blobs];
}

function key(artifact: Artifact): string {
  return [artifact.kind, artifact.slot, artifact.digest, artifact.bytes].join(":");
}

function changed(value: Change): Journal {
  if (!value.ok) throw new Error(`binding ${value.fault}`);
  return value.journal;
}

async function write(path: string, bytes: string | Uint8Array): Promise<void> {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function persist(path: string, bytes: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { mode: 0o700, recursive: true });
  try {
    await write(path, bytes);
  } catch (fault) {
    if ((fault as NodeJS.ErrnoException).code !== "EEXIST") throw fault;
    const current = await readFile(path);
    if (!current.equals(Buffer.from(bytes))) throw new Error("durable receipt conflict");
  }
}

async function exact(path: string, artifact: Artifact): Promise<boolean> {
  try {
    return verify(artifact, await bundle(path));
  } catch (fault) {
    if ((fault as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw fault;
  }
}

async function restore(store: Store, artifact: Artifact, root: string): Promise<string> {
  const destination = join(root, artifact.kind);
  if (await exact(destination, artifact)) return destination;
  const temporary = `${destination}.${randomUUID()}.tmp`;
  await materialize(await store.read(artifact), temporary);
  try {
    await rename(temporary, destination);
  } catch (fault) {
    await rm(temporary, { force: true, recursive: true });
    if (!["EEXIST", "ENOTEMPTY"].includes((fault as NodeJS.ErrnoException).code ?? "")) throw fault;
  }
  if (!await exact(destination, artifact)) throw new Error(`${artifact.kind} mount integrity mismatch`);
  return destination;
}

export class Capsule {
  constructor(
    readonly client: Client,
    readonly namespace: Namespace,
    readonly channel: Channel,
  ) {}

  async update(feed: Feed): Promise<Attempt | undefined> {
    const distribution = await feed.head(this.channel);
    if (!distribution.head) return undefined;
    const binding = await this.client.binding(this.namespace, this.channel);
    if (binding.state.current === distribution.head.generation && !binding.state.handoff) return undefined;
    const release = await feed.release(this.channel, distribution.head);
    return this.stage(release.envelope, release.assets);
  }

  async stage(input: unknown, contents: Content[], mode: Mode = "update"): Promise<Attempt> {
    const manifest = envelope(input);
    const expected = new Map(list(manifest).map((artifact) => [key(artifact), artifact]));
    if (expected.size !== contents.length) throw new Error("generation content mismatch");
    const nonce = randomUUID();
    const staging = await this.client.grant(this.namespace, {
      kind: "staging",
      name: "capsule",
      owner: nonce,
      scope: "attempt",
    });

    try {
      const cas = await this.client.grant(this.namespace, {
        kind: "cas",
        name: "artifact",
        scope: "namespace",
      });
      const store = await Store.open({ root: cas.value });
      await mkdir(staging.value, { mode: 0o700, recursive: true });
      for (const content of contents) {
        const artifact = expected.get(key(content.artifact));
        if (!artifact || !verify(artifact, content.bytes)) throw new Error("artifact verification failed");
        expected.delete(key(artifact));
        const path = join(staging.value, artifact.digest.slice(7));
        await write(path, content.bytes);
        const stored = await store.put(artifact.kind, artifact.slot, await readFile(path));
        if (key(stored) !== key(artifact)) throw new Error("artifact identity mismatch");
      }
      if (expected.size > 0) throw new Error("generation content missing");
      const data = await this.client.grant(this.namespace, {
        kind: "data",
        name: "capsule",
        scope: "namespace",
      });
      await persist(join(data.value, "generations", `${manifest.digest.slice(7)}.json`), canonical(manifest));
      const initial = await this.client.binding(this.namespace, this.channel);
      const armed = changed(await this.client.transit(this.namespace, this.channel, initial.revision, {
        mode,
        target: manifest.digest,
        type: "arm",
      }));
      const begun = changed(await this.client.transit(this.namespace, this.channel, armed.revision, {
        nonce,
        target: manifest.digest,
        type: "begin",
      }));
      return {
        channel: this.channel,
        lease: staging.lease,
        namespace: this.namespace,
        nonce,
        revision: begun.revision,
        target: manifest.digest,
      };
    } catch (fault) {
      await this.client.revoke(this.namespace, staging.lease);
      throw fault;
    }
  }

  async ready(attempt: Attempt, gate: Gate): Promise<Attempt> {
    if (!gates.includes(gate)) throw new TypeError("invalid readiness gate");
    const journal = changed(await this.client.transit(this.namespace, this.channel, attempt.revision, {
      gate,
      nonce: attempt.nonce,
      target: attempt.target,
      type: "ready",
    }));
    return { ...attempt, revision: journal.revision };
  }

  async commit(attempt: Attempt): Promise<Journal> {
    const journal = changed(await this.client.transit(this.namespace, this.channel, attempt.revision, {
      nonce: attempt.nonce,
      target: attempt.target,
      type: "commit",
    }));
    await this.client.revoke(this.namespace, attempt.lease);
    return journal;
  }

  async fail(attempt: Attempt, error: string): Promise<Journal> {
    const journal = changed(await this.client.transit(this.namespace, this.channel, attempt.revision, {
      error,
      nonce: attempt.nonce,
      target: attempt.target,
      type: "fail",
    }));
    await this.client.revoke(this.namespace, attempt.lease);
    return journal;
  }

  async recover(target: Digest): Promise<Attempt> {
    const nonce = randomUUID();
    const staging = await this.client.grant(this.namespace, {
      kind: "staging",
      name: "capsule",
      owner: nonce,
      scope: "attempt",
    });
    try {
      const initial = await this.client.binding(this.namespace, this.channel);
      const recovered = changed(await this.client.transit(this.namespace, this.channel, initial.revision, {
        target,
        type: "recover",
      }));
      const begun = changed(await this.client.transit(this.namespace, this.channel, recovered.revision, {
        nonce,
        target,
        type: "begin",
      }));
      return {
        channel: this.channel,
        lease: staging.lease,
        namespace: this.namespace,
        nonce,
        revision: begun.revision,
        target,
      };
    } catch (fault) {
      await this.client.revoke(this.namespace, staging.lease);
      throw fault;
    }
  }

  async mount(): Promise<Mount> {
    const binding = await this.client.binding(this.namespace, this.channel);
    const selected = startup(binding.state);
    if (selected.mode !== "normal") throw new Error(`capsule startup is ${selected.mode}`);
    return this.materialize(selected.target);
  }

  async prepare(attempt: Attempt): Promise<Mount> {
    const binding = await this.client.binding(this.namespace, this.channel);
    const active = binding.state.attempt;
    if (!active || active.status !== "running") throw new Error("capsule attempt is not running");
    if (active.nonce !== attempt.nonce || active.target !== attempt.target) {
      throw new Error("capsule attempt identity mismatch");
    }
    return this.materialize(attempt.target);
  }

  private async materialize(target: Digest): Promise<Mount> {
    const data = await this.client.grant(this.namespace, {
      kind: "data",
      name: "capsule",
      scope: "namespace",
    });
    const receipt = join(data.value, "generations", `${target.slice(7)}.json`);
    const manifest = envelope(JSON.parse(await readFile(receipt, "utf8")));
    if (manifest.digest !== target) throw new Error("generation receipt mismatch");
    const cas = await this.client.grant(this.namespace, {
      kind: "cas",
      name: "artifact",
      scope: "namespace",
    });
    const runtime = await this.client.grant(this.namespace, {
      kind: "data",
      name: "runtime",
      scope: "namespace",
    });
    const root = join(runtime.value, target.slice(7));
    const store = await Store.open({ root: cas.value });
    await mkdir(root, { mode: 0o700, recursive: true });
    const blobs: Record<string, string> = {};
    for (const artifact of manifest.generation.blobs) {
      const path = join(root, "blobs", artifact.slot);
      await persist(path, await store.read(artifact));
      blobs[artifact.slot] = path;
    }
    return {
      blobs,
      capsule: await restore(store, manifest.generation.capsule, root),
      daemon: await restore(store, manifest.generation.daemon, root),
      target,
      web: await restore(store, manifest.generation.web, root),
    };
  }
}
