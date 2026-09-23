import { describe, expect, it } from "vitest";

import { allocate, type Grant, namespace, type Registry, revoke } from "@";

function registry(name: string): Registry {
  return { grants: [], namespace: namespace(name), revision: 0 };
}

function port(owner: string, value: string): Grant {
  return {
    kind: "port",
    lease: `${owner}-lease`,
    name: "daemon",
    owner,
    scope: "attempt",
    value,
  };
}

describe("namespace", () => {
  it("isolates equal logical requests across namespaces", () => {
    const first = allocate(registry("first"), port("attempt", "tcp://127.0.0.1:4101"));
    const second = allocate(registry("second"), port("attempt", "tcp://127.0.0.1:4102"));

    expect(first.ok && first.grant.value).toBe("tcp://127.0.0.1:4101");
    expect(second.ok && second.grant.value).toBe("tcp://127.0.0.1:4102");
  });

  it("allows candidate generations to hold distinct attempt resources", () => {
    const first = allocate(registry("main"), port("first", "tcp://127.0.0.1:4101"));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = allocate(first.state, port("second", "tcp://127.0.0.1:4102"));

    expect(second.ok).toBe(true);
    expect(second.state.grants).toHaveLength(2);
  });

  it("rejects resource collisions inside one namespace", () => {
    const first = allocate(registry("main"), port("first", "tcp://127.0.0.1:4101"));
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    expect(allocate(first.state, port("second", "tcp://127.0.0.1:4101"))).toMatchObject({
      fault: "resource",
      ok: false,
    });
  });

  it("blocks cleanup while survivors remain", () => {
    const result = allocate(registry("main"), port("first", "tcp://127.0.0.1:4101"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(revoke(result.state, result.grant.lease, [42])).toMatchObject({
      fault: "survivors",
      ok: false,
    });
    expect(revoke(result.state, result.grant.lease, [])).toMatchObject({
      changed: true,
      ok: true,
    });
  });
});
