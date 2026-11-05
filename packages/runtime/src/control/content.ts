import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Library, LibrarySession, Resource, Use } from "@perishcode/blob";
import { type Binding, type Digest, type Envelope, envelope } from "@perishcode/protocol";
import type { Factory } from "@perishcode/sidecar";
import type { Content } from "../generations.js";

const resources = (value: Envelope): Resource[] =>
  value.generation.blobs.map((artifact) => ({ artifact, type: "file" }));
const unavailable = async (): Promise<Uint8Array> => {
  throw Error("committed blob bytes missing; reconciliation required");
};

/** Binding is authoritative; references are written first and retired last. */
export class ContentResources {
  constructor(
    readonly library: Library,
    private factory: Factory,
  ) {}
  private async manifest(target: Digest) {
    const data = await this.factory.grant({ kind: "data", name: "capsule", scope: "factory" });
    const value = envelope(
      JSON.parse(await readFile(join(data.value, "generations", `${target.slice(7)}.json`), "utf8")),
    );
    if (value.digest !== target) throw Error("generation receipt mismatch");
    return value;
  }
  async prepare(value: Envelope, contents: Content[]) {
    await this.library.session(async (library) => {
      await library.retain("prepared", value.digest, resources(value));
      for (const spec of resources(value)) {
        const asset = contents.find((c) => c.artifact.kind === "blob" && c.artifact.slot === spec.artifact.slot);
        if (!asset) throw Error("generation blob missing");
        await library.prefetch(spec, async () => Buffer.from(asset.bytes));
      }
    });
  }
  async synchronize(state: Binding, recovery?: Digest) {
    await this.library.session(async (library) => {
      const retained = await library.status();
      const wanted = new Set<string>();
      const keep = async (kind: "current" | "prepared" | "recovery", target: Digest) => {
        await library.retain(kind, target, resources(await this.manifest(target)));
        wanted.add(`${kind}:${target}`);
      };
      if (state.current) await keep("current", state.current);
      const pending = state.attempt?.target ?? state.handoff?.target;
      if (pending) await keep("prepared", pending);
      if (recovery && recovery !== state.current) await keep("recovery", recovery);
      for (const ref of retained.references) {
        // After a crash, retaining extra recovery generations is conservative.
        if (ref.kind === "recovery" && recovery === undefined) continue;
        if (!wanted.has(`${ref.kind}:${ref.name}`)) await library.unretain(ref.kind, ref.name);
      }
    });
  }
  async beforeCommit(state: Binding) {
    if (state.current && state.attempt?.target !== state.current)
      await this.library.session(async (library) => {
        await library.retain("recovery", state.current!, resources(await this.manifest(state.current!)));
      });
  }
  async use(target: Digest) {
    return this.library.session(async (library) => this.acquire(library, await this.manifest(target)));
  }
  private async acquire(library: LibrarySession, value: Envelope) {
    const uses: Use[] = [];
    try {
      for (const spec of resources(value)) uses.push(await library.acquire(spec, unavailable));
      return uses;
    } catch (error) {
      for (const use of uses) await library.release(use);
      throw error;
    }
  }
  async release(uses: Use[]) {
    await this.library.session(async (library) => {
      for (const use of uses) await library.release(use);
    });
  }
  async paths(value: Envelope) {
    const uses = await this.use(value.digest);
    try {
      return Object.fromEntries(resources(value).map((spec, i) => [spec.artifact.slot, uses[i]!.path]));
    } finally {
      await this.release(uses);
    }
  }
  async bytes(value: Envelope): Promise<Content[]> {
    const uses = await this.use(value.digest);
    try {
      return await Promise.all(
        resources(value).map(async (spec, i) => ({ artifact: spec.artifact, bytes: await readFile(uses[i]!.path) })),
      );
    } finally {
      await this.release(uses);
    }
  }
}
