import { type Channel, channel, type Namespace, namespace } from "@perishcode/protocol";

export interface SessionScope {
  namespace: Namespace;
  channel: Channel;
}
export interface SessionRecord extends SessionScope {
  incarnation: string;
  manager: string;
  kind: "automatic" | "local" | "remote";
  phase: "active" | "closing" | "completed" | "failed" | "interrupted";
  reason?: "callback" | "operation" | "disconnect";
}
/** Private control metadata; never part of caller-owned business protocols. */
export interface SessionHint extends SessionScope {
  incarnation: string;
  token: string;
  parent?: string;
}
export const sessionKey = (scope: SessionScope) => JSON.stringify([scope.namespace, scope.channel]);
export function sessionScope(input: unknown): SessionScope {
  const value = input as SessionScope;
  if (!value || typeof value.namespace !== "string" || typeof value.channel !== "string")
    throw new Error("invalid lifecycle scope");
  return { namespace: namespace(value.namespace), channel: channel(value.channel) };
}
export function sessionHint(input: unknown): SessionHint {
  const scope = sessionScope(input);
  const value = input as SessionHint;
  if (
    typeof value.incarnation !== "string" ||
    !value.incarnation ||
    typeof value.token !== "string" ||
    !value.token ||
    (value.parent !== undefined && (typeof value.parent !== "string" || !value.parent))
  )
    throw new Error("invalid lifecycle context");
  return {
    ...scope,
    incarnation: value.incarnation,
    token: value.token,
    ...(value.parent ? { parent: value.parent } : {}),
  };
}
