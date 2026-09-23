import { randomUUID } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import { join } from "node:path";

import { Store } from "@perish/blob";
import {
  envelope,
  gates,
  verify,
  type Artifact,
  type Channel,
  type Digest,
  type Envelope,
  type Gate,
  type Mode,
  type Namespace,
} from "@perish/protocol";
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

export class Capsule {
  constructor(
    readonly client: Client,
    readonly namespace: Namespace,
    readonly channel: Channel,
  ) {}

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
}
