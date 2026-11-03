import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { channel, digest, type Generation, identify, namespace } from "@perishcode/protocol";
import { Authority, Feed, type Release, writeFeed } from "@perishcode/publish";
import { Sources } from "@perishcode/serve";
import { serve } from "@perishcode/sidecar";
import { it } from "vitest";
import { type Status, watch } from "@/index.js";

function release(web: string, daemon = "daemon", capsule = "capsule"): Release {
  const assets = [
    { kind: "capsule", value: capsule },
    { kind: "web", value: web },
    { kind: "daemon", value: daemon },
  ].map(({ kind, value }) => ({
    artifact: { kind, slot: "main", bytes: Buffer.byteLength(value), digest: digest(value) },
    bytes: value,
  }));
  const generation = {
    schema: 1,
    carrier: 1,
    capsule: assets[0]?.artifact,
    web: assets[1]?.artifact,
    daemon: assets[2]?.artifact,
    blobs: [],
  } as Generation;
  return { envelope: { schema: 1, generation, digest: identify(generation) }, assets: assets as Release["assets"] };
}
async function until(read: () => Status, accept: (value: Status) => boolean) {
  const end = Date.now() + 5000;
  while (Date.now() < end) {
    const value = read();
    if (accept(value)) return value;
    await new Promise((done) => setTimeout(done, 10));
  }
  throw new Error(`discovery condition timeout: ${JSON.stringify(read())}`);
}

it("automatically prepares signed leaf candidates, rejects faults/regressions and cancels under sidecar lifetime", async () => {
  const root = await mkdtemp(join(tmpdir(), "discovery-")),
    content = join(root, "public");
  await mkdir(content);
  const pair = generateKeyPairSync("ed25519"),
    lane = channel("beta");
  const privatekey = pair.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const publickey = pair.publicKey.export({ format: "pem", type: "spki" }).toString();
  const authority = await Authority.open({ root: join(root, "authority"), privatekey });
  const initial = release("web1");
  await authority.publish(lane, 0, initial.envelope, initial.assets);
  const first = await writeFeed(authority, lane, content);
  const scope = { channel: lane, namespace: namespace("probe") };
  const source = await Sources.open({ data: join(root, "source"), scope, sources: { feed: { directory: content } } });
  const manager = await serve(join(root, "manager.sock"), undefined, undefined, join(root, "manager"));
  const factory = manager.factory(scope),
    before = await factory.binding();
  const observer = await watch(
    {
      content: async () => initial,
      expose: (name, options) =>
        factory.expose({ ...options, identity: { service: name, generation: initial.envelope.digest } }),
    },
    { endpoint: source.endpoints[0]?.url ?? "", publickey, intervalMs: 50, timeoutMs: 1500 },
  );
  try {
    await until(observer.status, (s) => s.phase === "idle" && s.checks > 0 && s.revision === 1);
    const next = release("web2");
    // Unchanged content is obtained from the verified seed cache, not fetched again.
    await source.fault("feed", {
      path: `/objects/${initial.envelope.generation.capsule.digest.slice(7)}`,
      mode: "missing",
    });
    await authority.publish(lane, 1, next.envelope, next.assets);
    await writeFeed(authority, lane, content);
    assert.deepEqual((await until(observer.status, (s) => s.phase === "prepared")).prepared?.changed, ["web"]);
    assert.equal((await observer.candidate())?.envelope.digest, next.envelope.digest);
    const copy = await observer.candidate();
    assert.ok(copy);
    copy.envelope.generation.carrier = 999;
    assert.equal((await observer.candidate())?.envelope.generation.carrier, 1);
    let revision = 2;
    for (const mode of ["missing", "corrupt", "truncate"] as const) {
      const incoming = release(`web-${mode}`),
        path = `/objects/${incoming.envelope.generation.web.digest.slice(7)}`;
      await source.fault("feed", { path, mode });
      await authority.publish(lane, revision++, incoming.envelope, incoming.assets);
      await writeFeed(authority, lane, content);
      const failure = await until(observer.status, (s) => s.phase === "failed" && s.revision === revision);
      assert.ok(failure.error);
      assert.equal(failure.current, initial.envelope.digest);
      assert.deepEqual(await factory.binding(), before);
      await source.fault("feed", null);
      await until(observer.status, (s) => s.phase === "prepared" && s.prepared?.target === incoming.envelope.digest);
    }
    const incompatible = release("web-bad", "daemon", "capsule2");
    await authority.publish(lane, revision++, incompatible.envelope, incompatible.assets);
    await writeFeed(authority, lane, content);
    assert.match(
      (await until(observer.status, (s) => s.phase === "failed" && s.revision === revision)).error ?? "",
      /requires capsule/,
    );
    await writeFile(join(content, "channels", lane), JSON.stringify(first));
    assert.match(
      (await until(observer.status, (s) => s.error?.includes("regressed") ?? false)).error ?? "",
      /regressed/,
    );
    const stalled = release("web-stalled");
    await source.fault("feed", { path: `/objects/${stalled.envelope.generation.web.digest.slice(7)}`, mode: "stall" });
    await authority.publish(lane, revision, stalled.envelope, stalled.assets);
    await writeFeed(authority, lane, content);
    const feed = new Feed(source.endpoints[0]?.url ?? "", publickey, { timeoutMs: 100 });
    const head = await feed.head(lane);
    assert.ok(head.head);
    await assert.rejects(feed.release(lane, head.head), /timeout/);
    await assert.rejects(
      new Feed(source.endpoints[0]?.url ?? "", publickey, { maxBytes: 1 }).release(lane, head.head),
      /limit/,
    );
    await until(observer.status, (s) => s.phase === "checking" && s.revision === revision + 1);
    const began = Date.now();
    await observer.close();
    assert.ok(Date.now() - began < 1000);
    assert.equal(observer.status().phase, "stopped");
    await assert.rejects(observer.check(), /stopped/);
    assert.deepEqual(await factory.binding(), before);
    assert.ok(!(await readFile(join(content, "channels", lane), "utf8")).includes("PRIVATE KEY"));
  } finally {
    await observer.close();
    await source.close();
    await manager.close();
    await rm(root, { recursive: true, force: true });
  }
}, 20000);
