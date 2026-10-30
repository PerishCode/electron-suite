import { type Namespace, namespace } from "@perishcode/protocol";
import { type Identity, identity } from "./types.js";

export type Phase = "initializing" | "ready" | "stopping" | "failed" | "retired";
export interface Instance extends Identity {
  incarnation: string;
  manager: string;
  kind: "hosted" | "process";
  phase: Phase;
  pid?: number;
}
export interface NamespaceEntry {
  namespace: Namespace;
  manager: string;
  incarnation?: string;
  phase: "unopened" | "opening" | "ready" | "failed" | "closed";
}
export interface Directory {
  schema: 1;
  revision: number;
  manager: { incarnation: string; pid: number; phase: "active" | "closed" | "interrupted" };
  namespaces: NamespaceEntry[];
  instances: Instance[];
}
export interface Observer {
  claim(scope: Identity, incarnation: string): void;
  change(scope: Identity, incarnation: string, phase: Phase, pid?: number): void;
}
export const slot = (scope: Identity) => JSON.stringify([scope.namespace, scope.channel, scope.service]);
const uuid = (value: unknown): string => {
  if (typeof value !== "string" || !/^[0-9a-f-]{36}$/.test(value)) throw new Error("invalid directory incarnation");
  return value;
};
export function parse(input: unknown, owner: Directory["manager"]): Directory {
  if (!input || typeof input !== "object") throw new Error("directory is missing; recovery required");
  const data = input as Directory;
  if (
    data.schema !== 1 ||
    !Number.isSafeInteger(data.revision) ||
    data.revision < 0 ||
    data.manager?.incarnation !== owner.incarnation ||
    data.manager?.pid !== owner.pid ||
    !Array.isArray(data.namespaces) ||
    !Array.isArray(data.instances)
  )
    throw new Error("invalid directory; recovery required");
  const namespaces = data.namespaces.map((entry): NamespaceEntry => {
    if (!["unopened", "opening", "ready", "failed", "closed"].includes(entry.phase))
      throw new Error("invalid namespace phase");
    if (typeof entry.namespace !== "string") throw new Error("invalid namespace identity");
    const value = {
      namespace: namespace(entry.namespace),
      manager: uuid(entry.manager),
      phase: entry.phase,
      ...(entry.incarnation === undefined ? {} : { incarnation: uuid(entry.incarnation) }),
    };
    if (value.phase === "ready" && !value.incarnation) throw new Error("namespace owner is unpublished");
    if (!["unopened", "closed"].includes(value.phase) && value.manager !== owner.incarnation)
      throw new Error("namespace owner mismatch");
    return value;
  });
  const instances = data.instances.map((entry): Instance => {
    const scope = identity(entry);
    if (
      !["hosted", "process"].includes(entry.kind) ||
      !["initializing", "ready", "stopping", "failed", "retired"].includes(entry.phase)
    )
      throw new Error("invalid instance phase or kind");
    if (entry.pid !== undefined && (!Number.isSafeInteger(entry.pid) || entry.pid < 1))
      throw new Error("invalid instance pid");
    if (entry.phase === "ready" && entry.pid === undefined) throw new Error("ready instance has no pid");
    if (
      entry.phase !== "retired" &&
      (entry.manager !== owner.incarnation || (entry.kind === "hosted" && entry.pid !== owner.pid))
    )
      throw new Error("instance owner mismatch");
    return {
      ...scope,
      manager: uuid(entry.manager),
      incarnation: uuid(entry.incarnation),
      kind: entry.kind,
      phase: entry.phase,
      ...(entry.pid === undefined ? {} : { pid: entry.pid }),
    };
  });
  if (
    new Set(namespaces.map((entry) => entry.namespace)).size !== namespaces.length ||
    new Set(instances.map(slot)).size !== instances.length
  )
    throw new Error("duplicate directory identity");
  if (
    owner.phase === "closed" &&
    (instances.some((entry) => entry.phase !== "retired") ||
      namespaces.some((entry) => !["closed", "unopened"].includes(entry.phase)))
  )
    throw new Error("closed manager has unretired directory entries");
  return {
    schema: 1,
    revision: data.revision,
    manager: { incarnation: owner.incarnation, pid: owner.pid, phase: owner.phase },
    namespaces,
    instances,
  };
}
