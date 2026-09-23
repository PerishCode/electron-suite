import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { channel, digest, namespace } from "@perish/protocol";

import { Bindings } from "@";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("bindings", () => {
  it("persists channel and namespace state with optimistic revisions", async () => {
    const root = await mkdtemp(join(tmpdir(), "binding-"));
    roots.push(root);
    const scope = namespace("main");
    const lane = channel("stable");
    const target = digest("first");
    const bindings = new Bindings(root);
    const initial = await bindings.read(scope, lane);
    const armed = await bindings.transit(scope, lane, initial.revision, {
      mode: "update",
      target,
      type: "arm",
    });

    expect(armed).toMatchObject({ changed: true, journal: { revision: 1 }, ok: true });
    expect(await new Bindings(root).read(scope, lane)).toEqual(armed.journal);

    const [first, stale] = await Promise.all([
      bindings.transit(scope, lane, 1, { nonce: "first", target, type: "begin" }),
      bindings.transit(scope, lane, 1, { nonce: "second", target, type: "begin" }),
    ]);

    expect(first).toMatchObject({ changed: true, journal: { revision: 2 }, ok: true });
    expect(stale).toMatchObject({ fault: "revision", journal: { revision: 2 }, ok: false });
  });
});
