import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { channel } from "@perishcode/protocol";
import { compose, resolve } from "@perishcode/release";
import { afterEach, expect, it } from "vitest";
import { Session, type SessionOptions, writeProduct } from "@";

const roots: string[] = [];
const sessions: Session[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((s) => s.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "runtime-"));
  roots.push(root);
  const manifest = resolve({}, { channel: channel("stable"), version: "1.0.0" });
  for (const name of ["capsule", "daemon", "web"]) await mkdir(join(root, name));
  await writeFile(
    join(root, "capsule/index.mjs"),
    'export async function activate(c) {return {title:"fixture", witness:c.generation}}',
  );
  const sdk = fileURLToPath(new URL("../dist/index.mjs", import.meta.url));
  await writeFile(
    join(root, "daemon/main.mjs"),
    `import {serveDaemon} from ${JSON.stringify(new URL(`file://${sdk}`).href)}; await serveDaemon("daemon1");`,
  );
  await writeFile(join(root, "web/index.html"), "fixture");
  await writeFile(join(root, "model"), "model1");
  const product = await compose(manifest, {
    capsule: join(root, "capsule"),
    daemon: join(root, "daemon"),
    web: join(root, "web"),
    carrier: 1,
    blobs: [{ slot: "model", path: join(root, "model") }],
  });
  await writeProduct(join(root, "seed"), product);
  const options: SessionOptions = {
    carrier: 1,
    executable: process.execPath,
    manifest,
    namespace: "fixture",
    root: join(root, "state"),
    seed: join(root, "seed"),
  };
  return { root, options, product };
}

it("executes the payload, binds daemon evidence and preserves data across cold starts", async () => {
  const { options, product } = await fixture();
  const first = await Session.open(options);
  sessions.push(first);
  const payload = await first.activate();
  expect(payload.witness).toBe(product.envelope.digest);
  await first.start();
  await first.request("write", { value: "retained" });
  const receipt = await first.confirm(payload, "renderer1");
  expect(receipt.daemon).toMatchObject({ generation: receipt.generation, nonce: receipt.nonce, witness: "daemon1" });
  expect(await first.close()).toEqual({ status: "stopped", survivors: [] });
  await expect(first.request("health")).rejects.toThrow("closed");
  const second = await Session.open(options);
  sessions.push(second);
  await second.activate();
  await second.start();
  expect(await second.request("read")).toEqual({ value: "retained" });
  expect(second.mount.target).toBe(receipt.generation);
  expect(second.nonce).not.toBe(receipt.nonce);
});

it("blocks after a failed attempt and requires explicit recovery", async () => {
  const { options } = await fixture();
  const first = await Session.open(options);
  sessions.push(first);
  const payload = await first.activate();
  await first.start();
  await first.confirm(payload, "renderer");
  await first.close();
  const next = await Session.open({ ...options, recover: true });
  sessions.push(next);
  await next.close("injected failure");
  await expect(Session.open(options)).rejects.toThrow("blocked");
  const recovered = await Session.open({ ...options, recover: true });
  sessions.push(recovered);
  await recovered.start();
  await recovered.confirm(await recovered.activate(), "renderer");
});

it("rejects incompatible carrier requirements before an activation attempt", async () => {
  const { options, product, root } = await fixture();
  const { identify } = await import("@perishcode/protocol");
  product.envelope.generation.carrier = 999;
  product.envelope.digest = identify(product.envelope.generation);
  await writeProduct(join(root, "bad"), product);
  await expect(Session.open({ ...options, candidate: join(root, "bad") })).rejects.toThrow("incompatible");
  const valid = await Session.open(options);
  sessions.push(valid);
  expect(valid.mount.target).not.toBe(product.envelope.digest);
});
