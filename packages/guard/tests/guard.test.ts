import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { inspect, type InspectOptions } from "@";

async function fixture(files: Record<string, string>): Promise<InspectOptions> {
  const root = await mkdtemp(join(tmpdir(), "guard-"));

  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }

  return {
    paths: Object.keys(files),
    root,
  };
}

describe("guard", () => {
  it("accepts the intended repository shape", async () => {
    const files = await fixture({
      ".githooks/pre-commit": "#!/bin/sh\n",
      "AGENTS.md": "# index\n",
      "packages/guard/src/index.ts": "export const guard = true;\n",
      "packages/guard/tests/guard.test.ts": "export const test = true;\n",
      "pnpm-workspace.yaml": "packages: []\n",
      "scripts/guard.mjs": "import '@perish/guard';\n",
    });

    await expect(inspect(files)).resolves.toEqual([]);
  });

  it("rejects compound names and script modules", async () => {
    const files = await fixture({
      "packages/guard/src/bad-name.ts": "export const bad = true;\n",
      "packages/guard/src/bad_name.ts": "export const bad = true;\n",
      "scripts/deep/run.js": "export function run() {}\n",
    });
    const findings = await inspect(files);

    expect(findings.map((item) => item.rule)).toEqual(expect.arrayContaining([
      "name.word",
      "script.flat",
      "script.module",
      "script.structure",
    ]));
  });

  it("applies source limits to tests", async () => {
    const files = await fixture({
      "packages/guard/tests/check.test.ts": `${"export const value = 1;\n".repeat(500)}          value;\n`,
    });
    const findings = await inspect(files);

    expect(findings.map((item) => item.rule)).toEqual([
      "source.indent",
      "source.lines",
    ]);
  });

  it("applies directory limits to tests", async () => {
    const entries = Object.fromEntries(Array.from({ length: 11 }, (_, index) => [
      `packages/guard/tests/item${index}.test.ts`,
      "export {};\n",
    ]));
    const findings = await inspect(await fixture(entries));

    expect(findings).toContainEqual(expect.objectContaining({
      path: "packages/guard/tests",
      rule: "directory.children",
    }));
  });

  it("limits staged checks to affected paths", async () => {
    const files = await fixture({
      "packages/guard/src/bad-name.ts": "export {};\n",
    });

    await expect(inspect({ ...files, targets: new Set() })).resolves.toEqual([]);
  });

  it("reserves prose for the root agent index", async () => {
    const files = await fixture({
      "notes.md": "prose\n",
    });
    const findings = await inspect(files);

    expect(findings).toContainEqual(expect.objectContaining({
      path: "notes.md",
      rule: "source.prose",
    }));
  });

  it("reserves app version identity for release", async () => {
    const files = await fixture({
      "apps/web/package.json": '{"version":"1.0.0"}\n',
    });
    const findings = await inspect(files);

    expect(findings).toContainEqual(expect.objectContaining({
      path: "apps/web/package.json",
      rule: "app.version",
    }));
  });
});
