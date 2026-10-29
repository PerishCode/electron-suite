import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { settings } from "../src/settings.js";

it("reads the shared pesuite runtime namespace and rejects unknown settings", async () => {
  const root = await mkdtemp(join(tmpdir(), "settings-"));
  try {
    const file = join(root, "pesuite.yaml");
    const yaml =
      "schemaVersion: 1\nguard: {}\nruntime:\n  appid: io.perish.slim\n  carrier: 1\n  channel: stable\n  name: slim\n  namespace: slim\n  scheme: slim\n  version: 1.0.0\n";
    await writeFile(file, yaml);
    expect((await settings(file)).manifest.identity.origin).toBe("slim://carrier");
    await writeFile(file, `${yaml}  typo: true\n`);
    await expect(settings(file)).rejects.toThrow("unknown");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
