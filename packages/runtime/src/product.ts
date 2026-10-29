import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { canonical, envelope, verify } from "@perishcode/protocol";
import { decode, encode, type Product } from "@perishcode/release";

export async function writeProduct(root: string, product: Product): Promise<void> {
  await mkdir(root, { recursive: true });
  for (const asset of product.assets) {
    if (!verify(asset.artifact, asset.bytes)) throw new Error("product asset mismatch");
    await writeFile(join(root, asset.artifact.digest.slice(7)), asset.bytes);
  }
  await writeFile(join(root, "release.json"), encode(product.manifest));
  await writeFile(join(root, "generation.json"), canonical(product.envelope));
}

export async function readProduct(root: string): Promise<Product> {
  const manifest = decode(await readFile(join(root, "release.json"), "utf8"));
  const value = envelope(JSON.parse(await readFile(join(root, "generation.json"), "utf8")));
  const g = value.generation;
  const assets = await Promise.all(
    [g.capsule, g.daemon, g.web, ...g.blobs].map(async (artifact) => {
      const bytes = await readFile(join(root, artifact.digest.slice(7)));
      if (!verify(artifact, bytes)) throw new Error("product asset verification failed");
      return { artifact, bytes };
    }),
  );
  return { assets, envelope: value, manifest };
}
