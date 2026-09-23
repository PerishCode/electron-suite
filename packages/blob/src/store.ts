import { randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

import { digest, kinds, valid, verify, type Artifact, type Digest, type Kind } from "@perish/protocol";

export interface Options {
  root: string;
}

function slot(value: string): string {
  if (!/^[a-z][a-z0-9]*$/.test(value)) throw new TypeError("artifact slot must be a single word");
  return value;
}

function bytes(value: string | Uint8Array): Uint8Array {
  return typeof value === "string" ? Buffer.from(value) : value;
}

export class Store {
  readonly #objects: string;

  private constructor(root: string) {
    this.#objects = resolve(root, "objects");
  }

  static async open(options: Options): Promise<Store> {
    const store = new Store(options.root);
    await mkdir(store.#objects, { mode: 0o700, recursive: true });
    return store;
  }

  async put(kind: Kind, name: string, content: string | Uint8Array): Promise<Artifact> {
    if (!kinds.includes(kind)) throw new TypeError("invalid artifact kind");
    const value = bytes(content);
    const identity = digest(value);
    const artifact: Artifact = {
      bytes: value.byteLength,
      digest: identity,
      kind,
      slot: slot(name),
    };
    const target = this.#path(identity);
    const temporary = join(this.#objects, `${randomUUID()}.tmp`);
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(value);
      await handle.sync();
    } finally {
      await handle.close();
    }

    try {
      await link(temporary, target);
    } catch (fault) {
      if ((fault as NodeJS.ErrnoException).code !== "EEXIST") throw fault;
    } finally {
      await rm(temporary, { force: true });
    }
    await this.read(artifact);
    return artifact;
  }

  async read(artifact: Artifact): Promise<Uint8Array> {
    if (!kinds.includes(artifact.kind) || !valid(artifact.digest)) throw new TypeError("invalid artifact");
    slot(artifact.slot);
    const content = await readFile(this.#path(artifact.digest));
    if (!verify(artifact, content)) throw new Error("artifact integrity mismatch");
    return content;
  }

  async has(artifact: Artifact): Promise<boolean> {
    try {
      await this.read(artifact);
      return true;
    } catch (fault) {
      if ((fault as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw fault;
    }
  }

  #path(identity: Digest): string {
    return join(this.#objects, identity.slice(7));
  }
}
