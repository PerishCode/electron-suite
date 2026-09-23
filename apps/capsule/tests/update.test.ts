import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  channel,
  digest,
  gates,
  identify,
  namespace,
  type Artifact,
  type Envelope,
  type Generation,
  type Kind,
} from "@perish/protocol";
import { Authority, Feed, serve, type Asset, type Service } from "@perish/publish";
import { Client, serve as sidecar, type Service as Sidecar } from "@perish/sidecar";
import { afterEach, describe, expect, it } from "vitest";

import { Capsule } from "@";

const roots: string[] = [];
const services: Service[] = [];
const sidecars: Sidecar[] = [];

function artifact(kind: Kind, slot: string, bytes: string): Artifact {
  return { bytes: Buffer.byteLength(bytes), digest: digest(bytes), kind, slot };
}

function fixture(seed: string): { assets: Asset[]; envelope: Envelope } {
  const values = ["capsule", "daemon", "web", "blob"].map((kind) => `${seed}${kind}`);
  const generation: Generation = {
    blobs: [artifact("blob", "model", values[3]!)],
    capsule: artifact("capsule", "main", values[0]!),
    carrier: 1,
    daemon: artifact("daemon", "main", values[1]!),
    schema: 1,
    web: artifact("web", "main", values[2]!),
  };
  return {
    assets: [generation.capsule, generation.daemon, generation.web, generation.blobs[0]!]
      .map((item, index) => ({ artifact: item, bytes: values[index]! })),
    envelope: { digest: identify(generation), generation, schema: 1 },
  };
}

async function commit(capsule: Capsule, feed: Feed): Promise<void> {
  let attempt = await capsule.update(feed);
  if (!attempt) throw new Error("update missing");
  for (const gate of gates) attempt = await capsule.ready(attempt, gate);
  await capsule.commit(attempt);
}

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close()));
  await Promise.all(sidecars.splice(0).map((service) => service.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("update", () => {
  it("isolates channel updates and preserves current after a failed upgrade", async () => {
    const root = await mkdtemp(join(tmpdir(), "update-"));
    roots.push(root);
    const host = await sidecar(join(root, "sidecar.sock"));
    sidecars.push(host);
    const client = new Client(host.endpoint, host.authority);
    const release = namespace("release");
    const data = await client.grant(release, { kind: "data", name: "publish", scope: "namespace" });
    const socket = await client.grant(release, {
      kind: "socket", name: "publish", owner: "server", scope: "attempt",
    });
    const port = await client.grant(release, {
      kind: "port", name: "publish", owner: "server", scheme: "http", scope: "attempt",
    });
    const pair = generateKeyPairSync("ed25519");
    const privatekey = pair.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    const publickey = pair.publicKey.export({ format: "pem", type: "spki" }).toString();
    const authority = await Authority.open({ privatekey, root: data.value });
    const server = await serve(authority, socket.value);
    services.push(server);
    await client.forward(release, port.lease, socket.lease);
    const feed = new Feed(port.value, publickey);
    const stable = channel("stable");
    const beta = channel("beta");
    const first = fixture("first");
    const preview = fixture("preview");
    await authority.publish(stable, 0, first.envelope, first.assets);
    await authority.publish(beta, 0, preview.envelope, preview.assets);
    const primary = new Capsule(client, namespace("primary"), stable);
    const secondary = new Capsule(client, namespace("secondary"), beta);

    await commit(primary, feed);
    await commit(secondary, feed);
    expect((await client.binding(namespace("primary"), stable)).state.current).toBe(first.envelope.digest);
    expect((await client.binding(namespace("secondary"), beta)).state.current).toBe(preview.envelope.digest);
    expect(await primary.update(feed)).toBeUndefined();

    const second = fixture("second");
    await authority.publish(stable, 1, second.envelope, second.assets);
    const forged = generateKeyPairSync("ed25519").publicKey.export({ format: "pem", type: "spki" }).toString();
    await expect(primary.update(new Feed(port.value, forged))).rejects.toThrow("trust");
    const attempt = await primary.update(feed);
    if (!attempt) throw new Error("second update missing");
    await primary.fail(attempt, "daemon timeout");

    expect((await client.binding(namespace("primary"), stable)).state.current).toBe(first.envelope.digest);
    expect((await client.binding(namespace("secondary"), beta)).state.current).toBe(preview.envelope.digest);
  });
});
