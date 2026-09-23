import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { canonical } from "@perish/protocol";

interface Entry {
  bytes: string;
  mode: 420 | 493;
  path: string;
}

interface Bundle {
  files: Entry[];
  schema: 1;
}

const pattern = /^[A-Za-z0-9][A-Za-z0-9./-]*$/;

function path(value: string): string {
  if (!pattern.test(value) || value.includes("//") || value.split("/").includes("..")) {
    throw new TypeError("bundle path is invalid");
  }
  return value;
}

async function walk(root: string, base = ""): Promise<Entry[]> {
  const entries = await readdir(join(root, base), { withFileTypes: true });
  const files: Entry[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const name = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await walk(root, name));
    else if (entry.isFile()) {
      const source = join(root, name);
      const mode = (await stat(source)).mode & 0o111 ? 0o755 : 0o644;
      files.push({ bytes: (await readFile(source)).toString("base64"), mode, path: path(name) });
    } else throw new TypeError("bundle entries must be files or directories");
  }
  return files;
}

function parse(input: string | Uint8Array): Bundle {
  const value: unknown = JSON.parse(Buffer.from(input).toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("bundle is invalid");
  const data = value as Record<string, unknown>;
  if (Object.keys(data).sort().join(":") !== "files:schema") throw new TypeError("bundle fields are invalid");
  if (data.schema !== 1 || !Array.isArray(data.files)) throw new TypeError("bundle header is invalid");
  const files = data.files.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new TypeError("bundle file is invalid");
    const file = item as Record<string, unknown>;
    const fields = Object.keys(file).sort().join(":");
    const encoded = typeof file.bytes === "string" && Buffer.from(file.bytes, "base64").toString("base64") === file.bytes;
    if (fields !== "bytes:mode:path" || !encoded || typeof file.path !== "string") {
      throw new TypeError("bundle file is invalid");
    }
    if (file.mode !== 0o644 && file.mode !== 0o755) {
      throw new TypeError("bundle file is invalid");
    }
    return { bytes: file.bytes as string, mode: file.mode, path: path(file.path) } as Entry;
  });
  const names = files.map((file) => file.path);
  if (new Set(names).size !== names.length || names.join("\0") !== [...names].sort().join("\0")) {
    throw new TypeError("bundle files must be unique and sorted");
  }
  for (const name of names) {
    if (names.some((other) => other !== name && other.startsWith(`${name}/`))) {
      throw new TypeError("bundle path collision");
    }
  }
  return { files, schema: 1 };
}

export async function bundle(
  root: string,
  extra: Readonly<Record<string, string | Uint8Array>> = {},
): Promise<Uint8Array> {
  const files = await walk(resolve(root));
  for (const [name, bytes] of Object.entries(extra)) {
    files.push({ bytes: Buffer.from(bytes).toString("base64"), mode: 0o644, path: path(name) });
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  return Buffer.from(canonical(parse(canonical({ files, schema: 1 }))));
}

export async function materialize(input: string | Uint8Array, root: string): Promise<void> {
  const archive = parse(input);
  const target = resolve(root);
  await mkdir(target, { mode: 0o700, recursive: true });
  for (const file of archive.files) {
    const destination = resolve(target, file.path);
    if (!destination.startsWith(`${target}/`)) throw new Error("bundle escaped target");
    await mkdir(dirname(destination), { mode: 0o700, recursive: true });
    await writeFile(destination, Buffer.from(file.bytes, "base64"), { flag: "wx", mode: file.mode });
  }
}
