import {
  channel,
  envelope,
  valid,
  verify,
  type Artifact,
  type Channel,
  type Distribution,
  type Envelope,
  type Pointer,
} from "@perish/protocol";

import type { Asset } from "./authority.js";
import { trust } from "./proof.js";

export interface Release {
  assets: Asset[];
  envelope: Envelope;
}

function endpoint(value: string): string {
  const url = new URL(value);
  const local = url.hostname === "127.0.0.1" || url.hostname === "::1" || url.hostname === "localhost";
  if (url.protocol !== "http:" || !local || !url.port || url.pathname !== "/") {
    throw new TypeError("feed endpoint must be loopback HTTP origin");
  }
  return url.origin;
}

function list(value: Envelope): Artifact[] {
  const generation = value.generation;
  return [generation.capsule, generation.daemon, generation.web, ...generation.blobs];
}

export class Feed {
  readonly #endpoint: string;
  readonly #publickey: string;

  constructor(endpointvalue: string, publickey: string) {
    this.#endpoint = endpoint(endpointvalue);
    this.#publickey = publickey;
  }

  async head(lane: Channel): Promise<Distribution> {
    const value: unknown = await this.#json(`/channels/${lane}`);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("invalid distribution");
    const data = value as Record<string, unknown>;
    if (channel(String(data.channel)) !== lane || !Number.isSafeInteger(data.revision) || Number(data.revision) < 0) {
      throw new TypeError("invalid distribution");
    }
    const state: Distribution = { channel: lane, revision: data.revision as number };
    if (data.head !== undefined) {
      const head = data.head as Record<string, unknown>;
      if (!valid(head?.generation) || !valid(head?.proof)) throw new TypeError("invalid distribution head");
      state.head = { generation: head.generation, proof: head.proof };
    }
    return state;
  }

  async release(lane: Channel, pointer: Pointer): Promise<Release> {
    const proof = await this.#json(`/proofs/${pointer.proof.slice(7)}`);
    trust(this.#publickey, lane, pointer, proof);
    const manifest = envelope(await this.#json(`/generations/${pointer.generation.slice(7)}`));
    if (manifest.digest !== pointer.generation) throw new Error("generation pointer mismatch");
    const assets = await Promise.all(list(manifest).map(async (artifact) => {
      const response = await fetch(`${this.#endpoint}/objects/${artifact.digest.slice(7)}`);
      if (!response.ok) throw new Error(`object request failed:${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!verify(artifact, bytes)) throw new Error("object integrity mismatch");
      return { artifact, bytes };
    }));
    return { assets, envelope: manifest };
  }

  async #json(path: string): Promise<unknown> {
    const response = await fetch(`${this.#endpoint}${path}`);
    if (!response.ok) throw new Error(`feed request failed:${response.status}`);
    return response.json() as Promise<unknown>;
  }
}
