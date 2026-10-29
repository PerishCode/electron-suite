import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { matches } from "../config/match.js";
import type { Entry, Policy } from "../types.js";

export async function files(root: string, policy: Policy): Promise<Entry[]> {
  const entries: Entry[] = [];
  async function walk(parent: string): Promise<void> {
    for (const child of await readdir(join(root, parent), { withFileTypes: true })) {
      const path = parent ? `${parent}/${child.name}` : child.name;
      if (child.name === ".git") continue;
      if (matches(path, policy.exclude) || matches(`${path}/`, policy.exclude)) continue;
      const kind = child.isSymbolicLink()
        ? "link"
        : child.isDirectory()
          ? "directory"
          : child.isFile()
            ? "file"
            : undefined;
      if (!kind) throw new Error(`unsupported filesystem entry: ${path}`);
      entries.push({ path, kind });
      if (kind === "directory") await walk(path);
    }
  }
  await walk("");
  return entries.sort((left, right) => left.path.localeCompare(right.path, "en"));
}
