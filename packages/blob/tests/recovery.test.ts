import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { channel, digest, namespace } from "@perishcode/protocol";
import {
  connectRoot,
  inspectRecovery,
  managerAlive,
  managerEndpoint,
  recover,
  serve,
  startManager,
} from "@perishcode/sidecar";
import { it } from "vitest";
import { Library, type Resource, resourceKey } from "@";

it("preserves loading/materialized/deleting interruption evidence and reconciles only after explicit sidecar recovery", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "blob-recovery-"))),
    library = pathToFileURL(join(process.cwd(), "dist/index.mjs")).href,
    sidecar = pathToFileURL(join(process.cwd(), "../sidecar/dist/index.mjs")).href,
    scope = { channel: channel("stable"), namespace: namespace("primary") },
    bytes = Buffer.from("recoverable resource"),
    spec: Resource = {
      type: "file",
      artifact: { kind: "blob", slot: "probe", bytes: bytes.length, digest: digest(bytes) },
    };
  for (const phase of ["loading", "materialized", "deleting"] as const) {
    const root = join(base, phase),
      program = join(base, phase + ".mjs");
    await writeFile(
      program,
      `
import{Library}from ${JSON.stringify(library)};import{serve,managerEndpoint,managerReady}from ${JSON.stringify(sidecar)};import{join}from'node:path';import{writeFile}from'node:fs/promises';
const root=${JSON.stringify(root)},scope=${JSON.stringify(scope)},resource=${JSON.stringify(spec)},bytes=Buffer.from(${JSON.stringify(bytes.toString())});
const service=await serve(managerEndpoint(root),{root});const factory=service.factory(scope);let library,context;
await factory.expose({identity:{service:'electron',generation:${JSON.stringify(digest("original"))}},handlers:{},lifecycle:{initialize:async c=>{context=c;library=await Library.open({factory,context:c,retentionMs:0,onCheckpoint:async e=>{if(e.phase===${JSON.stringify(phase)}){await writeFile(join(c.roots.logs,'checkpoint.json'),JSON.stringify(e),{flush:true});await new Promise(()=>{});}}});await writeFile(join(c.roots.data,'user-state'),'preserved');},stop:async()=>{}}});
await managerReady(service,root,scope);const use=await library.acquire(resource,async()=>bytes);await library.release(use);await library.collect();
`,
    );
    const witness = await startManager({
      root,
      scope,
      command: process.execPath,
      args: [program],
      log: join(base, phase + ".log"),
    });
    const connected = await connectRoot(root, scope),
      grants = (await connected.factory.resources()).grants,
      logs = grants.find((g) => g.kind === "logs")!.value,
      data = grants.find((g) => g.kind === "data" && g.name === "blob")!.value,
      user = grants.find((g) => g.kind === "data" && g.name !== "blob")!.value,
      cas = grants.find((g) => g.kind === "cas" && g.name === "blob")!.value;
    let checkpoint: { phase: string } | undefined;
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      try {
        checkpoint = JSON.parse(await readFile(join(logs, "checkpoint.json"), "utf8"));
        break;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      await new Promise((done) => setTimeout(done, 20));
    }
    assert.equal(checkpoint?.phase, phase);
    assert.equal(await managerAlive(witness), true);
    process.kill(witness.pid, "SIGKILL");
    while (await managerAlive(witness)) await new Promise((done) => setTimeout(done, 20));
    const retained = await readFile(join(data, "library.json"));
    await assert.rejects(serve(managerEndpoint(root), { root }), /interrupted.*recovery/);
    assert.deepEqual(await readFile(join(data, "library.json")), retained);
    const recovery = await inspectRecovery(root);
    assert.equal(recovery.phase, "ready");
    await recover(root, { expected: recovery.fingerprint });
    const service = await serve(managerEndpoint(root), { root }),
      factory = service.factory(scope);
    let reopened!: Library;
    await factory.expose({
      identity: { service: "electron", generation: digest("replacement") },
      handlers: {},
      lifecycle: {
        initialize: async (context) => {
          reopened = await Library.open({ factory, context, retentionMs: 0 });
        },
        stop: async () => {},
      },
    });
    try {
      const state = await reopened.status(),
        entry = state.entries[resourceKey(spec)];
      if (phase === "deleting") {
        assert.equal(entry, undefined);
        assert.deepEqual(await readdir(join(cas, "objects")), []);
      } else {
        assert.equal(entry?.phase, "failed");
        assert.equal(entry?.uses.length, 0);
        assert.equal(entry?.operation, undefined);
      }
      let fetched = 0;
      const use = await reopened.acquire(spec, async () => {
        fetched++;
        return bytes;
      });
      assert.equal(await readFile(use.path, "utf8"), bytes.toString());
      assert.equal(fetched, phase === "materialized" ? 0 : 1);
      assert.equal(await readFile(join(user, "user-state"), "utf8"), "preserved");
      await reopened.release(use);
      assert.deepEqual(await reopened.collect(), [resourceKey(spec)]);
    } finally {
      await reopened.close();
      await service.close();
    }
  }
}, 30000);
