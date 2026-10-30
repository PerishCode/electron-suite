import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { run } from "@";

it("prepares actual content through the formal release entry and rejects invalid options", async () => {
  const root = await mkdtemp(join(tmpdir(), "release cli "));
  const messages: string[] = [];
  const output = { stdout: (s: string) => messages.push(s), stderr: (s: string) => messages.push(s) };
  try {
    await writeFile(
      join(root, "pesuite.yaml"),
      "schemaVersion: 1\nruntime:\n  appid: io.perish.fixture\n  carrier: 1\n  channel: stable\n  name: fixture\n  namespace: fixture\n  scheme: fixture\n  version: 1.0.0\n",
    );
    for (const name of ["capsule", "daemon", "web"]) {
      await mkdir(join(root, name));
      await writeFile(join(root, name, "index.mjs"), "export const probe=1;");
    }
    await writeFile(join(root, "probe.bin"), "blob probe");
    const args = [
      "release",
      "--capsule",
      "capsule",
      "--daemon",
      "daemon",
      "--web",
      "web",
      "--blob",
      "probe=probe.bin",
      "--output",
      "seed",
    ];
    expect(await run(args, root, output)).toBe(0);
    const envelope = JSON.parse(await readFile(join(root, "seed/generation.json"), "utf8"));
    expect(envelope.generation.blobs).toHaveLength(1);
    expect(await run([...args, "--output", "other"], root, output)).toBe(2);
    expect(await run(["release", "--unexpected", "x"], root, output)).toBe(2);
    expect(await run(["pack", "--carrier", "capsule", "--seed", "seed", "--output", "."], root, output)).toBe(2);
    expect(await readFile(join(root, "capsule/index.mjs"), "utf8")).toContain("probe");
    expect(await run(["pack", "--carrier", "capsule", "--seed", "missing", "--output", "package"], root, output)).toBe(
      2,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
