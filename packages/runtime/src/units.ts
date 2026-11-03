import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { canonical, envelope, verify } from "@perishcode/protocol";
import type { Release } from "@perishcode/publish";
import { bundleFile, parseReleaseVersion, type Unit, unit } from "@perishcode/release";

export async function unitFile(path: string, kind: Unit["kind"]): Promise<Unit | undefined> {
  try {
    return unit(JSON.parse(await readFile(join(path, "unit.json"), "utf8")), kind);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
export function leaf(current: Release, incoming: Release, channel: string) {
  const before = envelope(current.envelope).generation,
    after = envelope(incoming.envelope).generation;
  if (
    before.carrier !== after.carrier ||
    canonical(before.capsule) !== canonical(after.capsule) ||
    canonical(before.blobs) !== canonical(after.blobs)
  )
    throw new Error("leaf update requires identical carrier/capsule/blobs");
  const pair = (release: Release) =>
    Object.fromEntries(
      (["web", "daemon"] as const).map((kind) => {
        const artifact = release.envelope.generation[kind],
          asset = release.assets.find((a) => a.artifact.kind === kind);
        if (!asset || !verify(artifact, asset.bytes)) throw new Error("leaf content integrity mismatch");
        return [
          kind,
          unit(JSON.parse(Buffer.from(bundleFile(asset.bytes, "unit.json")).toString("utf8")), kind, channel),
        ];
      }),
    ) as Record<Unit["kind"], Unit>;
  const previous = pair(current),
    next = pair(incoming);
  if (next.web.api !== next.daemon.api) throw new Error("incompatible web/daemon API");
  const changed = (["web", "daemon"] as const).filter((k) => before[k].digest !== after[k].digest);
  if (!changed.length) throw new Error("no changed leaf units");
  for (const kind of changed) {
    const a = parseReleaseVersion(previous[kind].version, channel),
      b = parseReleaseVersion(next[kind].version, channel);
    const av = [...a.baseVersion.split(".").map(Number), a.number ?? 0],
      bv = [...b.baseVersion.split(".").map(Number), b.number ?? 0];
    const first = av.findIndex((v, i) => v !== bv[i]);
    if (first < 0 || (bv[first] ?? 0) <= (av[first] ?? 0)) throw new Error("changed unit version must increase");
  }
  return { changed, next };
}
