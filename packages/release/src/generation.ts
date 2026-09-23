import { readFile } from "node:fs/promises";

import {
  digest,
  identify,
  type Artifact,
  type Envelope,
  type Generation,
  type Kind,
} from "@perish/protocol";

import { bundle } from "./bundle.js";
import { encode, type Manifest } from "./manifest.js";

export interface Blob {
  path: string;
  slot: string;
}

export interface Source {
  blobs?: Blob[];
  capsule: string;
  carrier: number;
  daemon: string;
  web: string;
}

export interface Asset {
  artifact: Artifact;
  bytes: Uint8Array;
}

export interface Product {
  assets: Asset[];
  envelope: Envelope;
  manifest: Manifest;
}

function artifact(kind: Kind, slot: string, bytes: Uint8Array): Artifact {
  return { bytes: bytes.byteLength, digest: digest(bytes), kind, slot };
}

export async function compose(manifest: Manifest, source: Source): Promise<Product> {
  const contents = {
    capsule: await bundle(source.capsule, { "release.json": encode(manifest) }),
    daemon: await bundle(source.daemon),
    web: await bundle(source.web),
  };
  const capsule = artifact("capsule", "main", contents.capsule);
  const daemon = artifact("daemon", "main", contents.daemon);
  const web = artifact("web", "main", contents.web);
  const blobassets = await Promise.all((source.blobs ?? []).map(async (blob) => {
    const bytes = await readFile(blob.path);
    return { artifact: artifact("blob", blob.slot, bytes), bytes };
  }));
  blobassets.sort((left, right) => left.artifact.slot.localeCompare(right.artifact.slot));
  const generation: Generation = {
    blobs: blobassets.map((asset) => asset.artifact),
    capsule,
    carrier: source.carrier,
    daemon,
    schema: 1,
    web,
  };
  return {
    assets: [
      { artifact: capsule, bytes: contents.capsule },
      { artifact: daemon, bytes: contents.daemon },
      { artifact: web, bytes: contents.web },
      ...blobassets,
    ],
    envelope: { digest: identify(generation), generation, schema: 1 },
    manifest,
  };
}
