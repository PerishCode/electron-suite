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
import { Client, serve, type Service } from "@perish/sidecar";
import { afterEach, describe, expect, it } from "vitest";

import { Capsule, type Content } from "@";

const roots: string[] = [];
const services: Service[] = [];

function artifact(kind: Kind, slot: string, bytes: string): Artifact {
  return { bytes: Buffer.byteLength(bytes), digest: digest(bytes), kind, slot };
}

function fixture(seed: string): { contents: Content[]; envelope: Envelope } {
  const values = {
    blob: `${seed}blob`,
    capsule: `${seed}capsule`,
    daemon: `${seed}daemon`,
    web: `${seed}web`,
  };
  const generation: Generation = {
    blobs: [artifact("blob", "model", values.blob)],
    capsule: artifact("capsule", "main", values.capsule),
    carrier: 1,
    daemon: artifact("daemon", "main", values.daemon),
    schema: 1,
    web: artifact("web", "main", values.web),
  };
  return {
    contents: [
      { artifact: generation.capsule, bytes: values.capsule },
      { artifact: generation.daemon, bytes: values.daemon },
      { artifact: generation.web, bytes: values.web },
      { artifact: generation.blobs[0]!, bytes: values.blob },
    ],
    envelope: { digest: identify(generation), generation, schema: 1 },
  };
}

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("capsule", () => {
  it("commits verified generations and explicitly recovers after failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "capsule-"));
    roots.push(root);
    const service = await serve(join(root, "sidecar.sock"));
    services.push(service);
    const client = new Client(service.endpoint, service.authority);
    const scope = namespace("main");
    const lane = channel("stable");
    const capsule = new Capsule(client, scope, lane);
    const first = fixture("first");
    let attempt = await capsule.stage(first.envelope, first.contents);

    for (const gate of gates) attempt = await capsule.ready(attempt, gate);
    const committed = await capsule.commit(attempt);
    expect(committed.state.current).toBe(first.envelope.digest);

    const second = fixture("second");
    attempt = await capsule.stage(second.envelope, second.contents);
    attempt = await capsule.ready(attempt, "capsule");
    const failed = await capsule.fail(attempt, "daemon timeout");
    expect(failed.state.current).toBe(first.envelope.digest);

    attempt = await capsule.recover(first.envelope.digest);
    for (const gate of gates) attempt = await capsule.ready(attempt, gate);
    const recovered = await capsule.commit(attempt);
    expect(recovered.state).toEqual({ channel: lane, current: first.envelope.digest, namespace: scope });
    expect((await client.resources(scope)).grants.map((grant) => grant.kind)).toEqual(["cas"]);
  });

  it("rejects content before arming a generation", async () => {
    const root = await mkdtemp(join(tmpdir(), "capsule-"));
    roots.push(root);
    const service = await serve(join(root, "sidecar.sock"));
    services.push(service);
    const client = new Client(service.endpoint, service.authority);
    const scope = namespace("preview");
    const lane = channel("beta");
    const capsule = new Capsule(client, scope, lane);
    const value = fixture("broken");
    value.contents[0] = { ...value.contents[0]!, bytes: "tampered" };

    await expect(capsule.stage(value.envelope, value.contents)).rejects.toThrow("verification");
    expect(await client.binding(scope, lane)).toMatchObject({ revision: 0, state: { channel: lane } });
    expect((await client.resources(scope)).grants.map((grant) => grant.kind)).toEqual(["cas"]);
  });
});
