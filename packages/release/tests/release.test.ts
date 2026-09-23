import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { define } from "@perish/config";
import { channel } from "@perish/protocol";
import { describe, expect, it } from "vitest";

import { decode, distinct, emit, encode, parse, resolve } from "@";

describe("release", () => {
  it("derives independent installation identity per channel", () => {
    const config = define();
    const stable = resolve(config, { channel: channel("stable"), version: "1.2.3" });
    const beta = resolve(config, { channel: channel("beta"), version: "1.2.3-beta.1" });

    expect(stable.identity).toMatchObject({
      appid: "io.perish.electronsuite",
      name: "electron-suite",
      origin: "electronsuite://carrier",
      scheme: "electronsuite",
    });
    expect(beta.identity.appid).toBe("io.perish.electronsuite.beta");
    expect(() => distinct([stable, beta])).not.toThrow();
  });

  it("resolves optional capabilities through the same context", () => {
    const seen: string[] = [];
    const config = define({
      name: ({ channel }) => `Perish ${channel}`,
      scheme: ({ channel }) => `perish-${channel}`,
      version: ({ channel, version }) => {
        seen.push(channel);
        return version;
      },
    });
    const manifest = resolve(config, { channel: channel("canary"), version: "2.0.0" });

    expect(manifest.identity).toMatchObject({
      name: "Perish canary",
      origin: "perish-canary://carrier",
      scheme: "perish-canary",
      version: "2.0.0",
    });
    expect(seen).toEqual(["canary", "canary"]);
  });

  it("rejects nondeterminism and invalid platform identity", () => {
    let call = 0;
    const input = { channel: channel("stable"), version: "1.0.0" };

    expect(() => resolve(define({ name: () => String(call += 1) }), input)).toThrow("deterministic");
    expect(() => resolve(define({ scheme: () => "Bad Scheme" }), input)).toThrow("scheme");
    expect(() => resolve(define(), { ...input, version: "latest" })).toThrow("version");
  });

  it("rejects runtime manifests that drift from resolved identity", () => {
    const manifest = resolve(define(), { channel: channel("stable"), version: "1.0.0" });

    expect(() => parse({ ...manifest, extra: true })).toThrow("fields");
    expect(() => parse({
      ...manifest,
      identity: { ...manifest.identity, origin: "other://carrier" },
    })).toThrow("inconsistent");
    expect(() => parse({
      ...manifest,
      identity: { ...manifest.identity, version: "latest" },
    })).toThrow("version");
    expect(() => distinct([manifest, manifest])).toThrow("collision");
  });

  it("roundtrips one canonical build and runtime manifest", () => {
    const manifest = resolve(define(), { channel: channel("stable"), version: "1.0.0" });
    expect(decode(encode(manifest))).toEqual(manifest);
    expect(encode(manifest)).toBe(`${JSON.stringify(manifest)}\n`);
  });

  it("emits release identity outside source manifests", async () => {
    const root = await mkdtemp(join(tmpdir(), "perish-release-"));
    const manifest = resolve(define(), { channel: channel("stable"), version: "3.2.1" });
    const path = await emit(root, manifest);

    expect(decode(await readFile(path, "utf8"))).toEqual(manifest);
    expect(path).toBe(join(root, "release.json"));
  });
});
