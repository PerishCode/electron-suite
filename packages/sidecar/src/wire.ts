import {
  channel,
  namespace,
  resources,
  gates,
  valid,
  type Capability,
  type Channel,
  type Event,
  type Gate,
  type Grant,
  type Permit,
  type Namespace,
  type Registry,
  type Request as ResourceRequest,
} from "@perish/protocol";

import type { Lease, Release, Snapshot, Spec } from "./host.js";
import type { Change, Journal } from "./binding.js";

export type Request =
  | { authority: string; spec: Spec; type: "start" }
  | { lease: Lease; type: "attach" }
  | { lease: Lease; type: "release" }
  | { authority: string; type: "inspect" }
  | { authority: string; channel: Channel; namespace: Namespace; type: "binding" }
  | {
      authority: string;
      channel: Channel;
      event: Event;
      namespace: Namespace;
      revision: number;
      type: "transit";
    }
  | { authority: string; permit: Permit; type: "issue" }
  | { authority: string; capability: Capability; type: "retire" }
  | { authority: string; namespace: string; resource: ResourceRequest; type: "grant" }
  | { authority: string; namespace: string; port: string; socket: string; type: "forward" }
  | { authority: string; lease: string; namespace: string; survivors: number[]; type: "revoke" }
  | { authority: string; namespace: string; type: "resources" };

export type Response =
  | { ok: true; value: boolean | Capability | Change | Grant | Journal | Lease | Registry | Release | Snapshot[] }
  | { error: string; ok: false };

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }

  return value as Record<string, unknown>;
}

function text(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${name} must be a nonempty string`);
  }

  return value;
}

function number(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${name} must be a nonnegative integer`);
  }

  return value as number;
}

function lease(value: unknown): Lease {
  const data = record(value, "lease");
  const generation = text(data.generation, "lease.generation");

  if (!valid(generation)) throw new TypeError("lease.generation is invalid");

  return {
    attachment: text(data.attachment, "lease.attachment"),
    capability: text(data.capability, "lease.capability"),
    channel: channel(text(data.channel, "lease.channel")),
    generation,
    namespace: namespace(text(data.namespace, "lease.namespace")),
    pid: number(data.pid, "lease.pid"),
    slot: text(data.slot, "lease.slot"),
  };
}

function spec(value: unknown): Spec {
  const data = record(value, "spec");
  const generation = text(data.generation, "spec.generation");

  if (!valid(generation)) throw new TypeError("spec.generation is invalid");
  if (data.args !== undefined && !Array.isArray(data.args)) {
    throw new TypeError("spec.args must be an array");
  }

  const args = data.args?.map((item) => text(item, "spec.args"));
  const result: Spec = {
    channel: channel(text(data.channel, "spec.channel")),
    command: text(data.command, "spec.command"),
    generation,
    namespace: namespace(text(data.namespace, "spec.namespace")),
    ready: text(data.ready, "spec.ready"),
    slot: text(data.slot, "spec.slot"),
  };

  if (args) result.args = args;
  if (data.cwd !== undefined) result.cwd = text(data.cwd, "spec.cwd");
  if (data.env !== undefined) {
    const env = record(data.env, "spec.env");
    result.env = Object.fromEntries(Object.entries(env).map(([key, item]) => [key, text(item, `spec.env.${key}`)]));
  }
  if (data.grace !== undefined) result.grace = number(data.grace, "spec.grace");
  if (data.timeout !== undefined) result.timeout = number(data.timeout, "spec.timeout");
  return result;
}

function resource(value: unknown): ResourceRequest {
  const data = record(value, "resource");
  const kind = text(data.kind, "resource.kind");
  const scope = text(data.scope, "resource.scope");
  if (!resources.includes(kind as ResourceRequest["kind"])) throw new TypeError("resource.kind is invalid");
  if (scope !== "namespace" && scope !== "attempt") throw new TypeError("resource.scope is invalid");
  const result: ResourceRequest = {
    kind: kind as ResourceRequest["kind"],
    name: text(data.name, "resource.name"),
    scope,
  };
  if (data.owner !== undefined) result.owner = text(data.owner, "resource.owner");
  if (data.scheme !== undefined) {
    const scheme = text(data.scheme, "resource.scheme");
    if (scheme !== "http" && scheme !== "tcp") throw new TypeError("resource.scheme is invalid");
    result.scheme = scheme;
  }
  return result;
}

function permit(value: unknown): Permit {
  const data = record(value, "permit");
  const word = (name: string) => {
    const value = text(data[name], `permit.${name}`);
    if (!/^[a-z][a-z0-9]*$/.test(value)) throw new TypeError(`permit.${name} must be a single word`);
    return value;
  };

  return {
    channel: channel(text(data.channel, "permit.channel")),
    namespace: namespace(text(data.namespace, "permit.namespace")),
    owner: word("owner"),
    service: word("service"),
  };
}

function capability(value: unknown): Capability {
  const data = record(value, "capability");
  return {
    ...permit(data),
    token: text(data.token, "capability.token"),
  };
}

function event(value: unknown): Event {
  const data = record(value, "event");
  const type = text(data.type, "event.type");
  const identity = text(data.target, "event.target");
  if (!valid(identity)) throw new TypeError("event.target is invalid");
  if (type === "arm") {
    if (data.mode !== "update" && data.mode !== "recovery") throw new TypeError("event.mode is invalid");
    return { mode: data.mode, target: identity, type };
  }
  if (type === "recover") return { target: identity, type };
  const nonce = text(data.nonce, "event.nonce");
  if (type === "begin" || type === "commit") return { nonce, target: identity, type };
  if (type === "fail") {
    return { error: text(data.error, "event.error"), nonce, target: identity, type };
  }
  if (type === "ready") {
    const gate = text(data.gate, "event.gate");
    if (!gates.includes(gate as Gate)) throw new TypeError("event.gate is invalid");
    return { gate: gate as Gate, nonce, target: identity, type };
  }
  throw new TypeError("event.type is invalid");
}

export function decode(value: string): Request {
  const data = record(JSON.parse(value), "request");

  if (data.type === "start") {
    return { authority: text(data.authority, "authority"), spec: spec(data.spec), type: "start" };
  }

  if (data.type === "attach" || data.type === "release") {
    return { lease: lease(data.lease), type: data.type };
  }

  if (data.type === "inspect") {
    return { authority: text(data.authority, "authority"), type: "inspect" };
  }

  if (data.type === "binding") {
    return {
      authority: text(data.authority, "authority"),
      channel: channel(text(data.channel, "channel")),
      namespace: namespace(text(data.namespace, "namespace")),
      type: "binding",
    };
  }

  if (data.type === "transit") {
    return {
      authority: text(data.authority, "authority"),
      channel: channel(text(data.channel, "channel")),
      event: event(data.event),
      namespace: namespace(text(data.namespace, "namespace")),
      revision: number(data.revision, "revision"),
      type: "transit",
    };
  }

  if (data.type === "issue") {
    return {
      authority: text(data.authority, "authority"),
      permit: permit(data.permit),
      type: "issue",
    };
  }

  if (data.type === "retire") {
    return {
      authority: text(data.authority, "authority"),
      capability: capability(data.capability),
      type: "retire",
    };
  }

  if (data.type === "grant") {
    return {
      authority: text(data.authority, "authority"),
      namespace: namespace(text(data.namespace, "namespace")),
      resource: resource(data.resource),
      type: "grant",
    };
  }

  if (data.type === "forward") {
    return {
      authority: text(data.authority, "authority"),
      namespace: namespace(text(data.namespace, "namespace")),
      port: text(data.port, "port"),
      socket: text(data.socket, "socket"),
      type: "forward",
    };
  }

  if (data.type === "revoke") {
    if (!Array.isArray(data.survivors)) throw new TypeError("survivors must be an array");
    return {
      authority: text(data.authority, "authority"),
      lease: text(data.lease, "lease"),
      namespace: namespace(text(data.namespace, "namespace")),
      survivors: data.survivors.map((item) => number(item, "survivor")),
      type: "revoke",
    };
  }

  if (data.type === "resources") {
    return {
      authority: text(data.authority, "authority"),
      namespace: namespace(text(data.namespace, "namespace")),
      type: "resources",
    };
  }

  throw new TypeError("request type is invalid");
}

export function encode(value: Request | Response): string {
  return `${JSON.stringify(value)}\n`;
}
