import { describe, expect, it, vi } from "vitest";

import { Daemon, mount, type Transport } from "@";

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
    status,
  });
}

describe("web", () => {
  it("rejects endpoints outside the injected loopback origin", () => {
    expect(() => new Daemon("https://example.com", "token")).toThrow("loopback");
    expect(() => new Daemon("http://127.0.0.1:4100/path", "token")).toThrow("loopback");
  });

  it("uses only the injected endpoint and capability", async () => {
    const transport = vi.fn<Transport>().mockResolvedValue(response({ ok: true, pid: 42 }));
    const daemon = new Daemon("http://127.0.0.1:4100", "secret", transport);

    await expect(daemon.health()).resolves.toEqual({ ok: true, pid: 42 });
    expect(transport).toHaveBeenCalledWith("http://127.0.0.1:4100/health", expect.objectContaining({
      credentials: "omit",
      headers: { authorization: "Bearer secret" },
      method: "GET",
      mode: "cors",
    }));
  });

  it("binds browser interaction to the daemon API", async () => {
    const transport = vi.fn<Transport>()
      .mockResolvedValueOnce(response({ ok: true, pid: 42 }))
      .mockResolvedValueOnce(response({ value: "stored" }));
    mount(document.body, { daemon: "http://127.0.0.1:4100", token: "secret" }, transport);
    await vi.waitFor(() => expect(document.querySelector("output")?.textContent).toBe("ready"));
    const input = document.querySelector("input");
    if (!input) throw new Error("input missing");
    input.value = "stored";
    document.querySelectorAll("button")[1]?.click();

    await vi.waitFor(() => expect(document.querySelector("output")?.textContent).toBe('{"value":"stored"}'));
    expect(transport).toHaveBeenLastCalledWith("http://127.0.0.1:4100/state", expect.objectContaining({
      body: '{"value":"stored"}',
      method: "PUT",
    }));
  });
});
