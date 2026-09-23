import { mkdir, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { encode, type Manifest } from "./manifest.js";

export async function emit(root: string, manifest: Manifest): Promise<string> {
  const directory = resolve(root);
  const target = join(directory, "release.json");
  const temporary = join(directory, "release.tmp");
  await mkdir(directory, { recursive: true });
  await writeFile(temporary, encode(manifest), { mode: 0o600 });
  await rename(temporary, target);
  return target;
}
