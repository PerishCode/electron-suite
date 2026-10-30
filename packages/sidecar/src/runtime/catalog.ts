import { join } from "node:path";
import { type Namespace, namespace } from "@perishcode/protocol";
import {
  type Directory,
  type Instance,
  type NamespaceEntry,
  type Observer,
  type Phase,
  parse,
  slot,
} from "../control/directory.js";
import type { Identity } from "../control/types.js";
import { Ownership } from "./ownership.js";

export class Catalog {
  private constructor(
    private owner: Ownership,
    private state: Directory,
  ) {}
  static open(owner: Ownership): Catalog {
    const prior = owner.readDirectory();
    if (prior === undefined && owner.previous?.directory) throw new Error("directory missing; recovery required");
    const old = prior === undefined ? undefined : parse(prior, owner.previous ?? owner.info);
    const state: Directory = {
      schema: 1,
      revision: (old?.revision ?? -1) + 1,
      manager: { incarnation: owner.incarnation, pid: owner.info.pid, phase: "active" },
      namespaces: old?.namespaces ?? [],
      instances: old?.instances ?? [],
    };
    owner.writeDirectory(state);
    return new Catalog(owner, state);
  }
  snapshot(scope?: Namespace): Directory {
    const info = this.owner.info;
    const result = parse(this.state, info);
    if (scope !== undefined) {
      namespace(scope);
      result.namespaces = result.namespaces.filter((entry) => entry.namespace === scope);
      result.instances = result.instances.filter((entry) => entry.namespace === scope);
    }
    return result;
  }
  private update(change: (next: Directory) => void): void {
    this.owner.info;
    const next = structuredClone(this.state);
    change(next);
    next.revision++;
    const parsed = parse(next, this.owner.info);
    this.owner.writeDirectory(parsed);
    this.state = parsed;
  }
  namespace(scope: Namespace, phase: NamespaceEntry["phase"], incarnation?: string): void {
    namespace(scope);
    this.update((next) => {
      const index = next.namespaces.findIndex((entry) => entry.namespace === scope);
      const entry: NamespaceEntry = {
        namespace: scope,
        manager: next.manager.incarnation,
        phase,
        ...(incarnation ? { incarnation } : {}),
      };
      if (index < 0) next.namespaces.push(entry);
      else next.namespaces[index] = entry;
    });
  }
  claim(scope: Identity, incarnation: string, kind: Instance["kind"]): void {
    this.update((next) => {
      const index = next.instances.findIndex((entry) => slot(entry) === slot(scope));
      if (!next.namespaces.some((entry) => entry.namespace === scope.namespace))
        next.namespaces.push({ namespace: scope.namespace, manager: next.manager.incarnation, phase: "unopened" });
      if (index >= 0 && next.instances[index]?.phase !== "retired") throw new Error("service already owned");
      const entry: Instance = {
        ...scope,
        incarnation,
        manager: next.manager.incarnation,
        kind,
        phase: "initializing",
        ...(kind === "hosted" ? { pid: process.pid } : {}),
      };
      if (index < 0) next.instances.push(entry);
      else next.instances[index] = entry;
    });
  }
  change(scope: Identity, incarnation: string, phase: Phase, pid?: number): void {
    const current = this.state.instances.find((entry) => slot(entry) === slot(scope));
    if (!current || current.incarnation !== incarnation || current.generation !== scope.generation)
      throw new Error("directory incarnation is fenced");
    if (current.phase === phase && (pid === undefined || pid === current.pid)) return;
    const transitions: Record<Phase, Phase[]> = {
      initializing: ["ready", "stopping", "failed", "retired"],
      ready: ["stopping", "failed"],
      stopping: ["failed", "retired"],
      failed: ["stopping"],
      retired: [],
    };
    if (!transitions[current.phase].includes(phase)) throw new Error("invalid directory transition");
    this.update((next) => {
      const entry = next.instances.find((entry) => slot(entry) === slot(scope)) as Instance;
      entry.phase = phase;
      if (pid !== undefined) entry.pid = pid;
    });
  }
  observer(): Observer {
    return {
      claim: (scope, id) => this.claim(scope, id, "process"),
      change: (scope, id, phase, pid) => this.change(scope, id, phase, pid),
    };
  }
  drained(): void {
    if (this.state.instances.some((entry) => entry.phase !== "retired"))
      throw new Error("directory has unretired instances");
    if (this.state.namespaces.some((entry) => !["closed", "unopened"].includes(entry.phase)))
      throw new Error("directory has unclosed namespaces");
  }
}

/** Last committed facts only; an interrupted manager does not imply its child PIDs are dead. */
export async function readDirectory(root: string, scope?: Namespace): Promise<Directory> {
  const snapshot = await Ownership.inspect(join(root, "manager.sqlite"));
  if (!snapshot.owner.directory) throw new Error("directory unavailable; recovery required");
  const result = parse(snapshot.directory, {
    ...snapshot.owner,
    phase: snapshot.owner.phase === "active" ? "interrupted" : "closed",
  });
  if (scope !== undefined) {
    namespace(scope);
    result.namespaces = result.namespaces.filter((entry) => entry.namespace === scope);
    result.instances = result.instances.filter((entry) => entry.namespace === scope);
  }
  return result;
}
