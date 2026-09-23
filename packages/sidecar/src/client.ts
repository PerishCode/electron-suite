import { createConnection } from "node:net";

import type {
  Capability,
  Grant,
  Permit,
  Namespace,
  Registry,
  Request as ResourceRequest,
} from "@perish/protocol";

import type { Lease, Release, Snapshot, Spec } from "./host.js";
import { encode, type Request, type Response } from "./wire.js";

const limit = 64 * 1024;

function decode(input: string, end: number): Response {
  const value: unknown = JSON.parse(input.slice(0, end));

  if (!value || typeof value !== "object" || !("ok" in value)) {
    throw new TypeError("invalid response");
  }

  return value as Response;
}

function call(endpoint: string, request: Request, timeout: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(endpoint);
    let input = "";
    let settled = false;
    const finish = (operation: () => void) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      operation();
    };

    socket.setTimeout(timeout, () => finish(() => reject(new Error("request timeout"))));
    socket.once("connect", () => socket.write(encode(request)));
    socket.once("error", (error) => finish(() => reject(error)));
    socket.on("data", (chunk: Buffer) => {
      input += chunk.toString("utf8");
      if (Buffer.byteLength(input) > limit) {
        finish(() => reject(new Error("response exceeds limit")));
        return;
      }

      const end = input.indexOf("\n");
      if (end < 0) return;

      try {
        const response = decode(input, end);
        if (!response.ok) finish(() => reject(new Error(response.error)));
        else finish(() => resolve(response.value));
      } catch (error) {
        finish(() => reject(error));
      }
    });
  });
}

export class Client {
  constructor(
    readonly endpoint: string,
    readonly authority: string,
    readonly timeout = 5000,
  ) {}

  async start(spec: Spec): Promise<Lease> {
    return await call(this.endpoint, {
      authority: this.authority,
      spec,
      type: "start",
    }, this.timeout) as Lease;
  }

  async attach(lease: Lease): Promise<Lease> {
    return await call(this.endpoint, { lease, type: "attach" }, this.timeout) as Lease;
  }

  async release(lease: Lease): Promise<Release> {
    return await call(this.endpoint, { lease, type: "release" }, this.timeout) as Release;
  }

  async inspect(): Promise<Snapshot[]> {
    return await call(this.endpoint, {
      authority: this.authority,
      type: "inspect",
    }, this.timeout) as Snapshot[];
  }

  async issue(permit: Permit): Promise<Capability> {
    return await call(this.endpoint, {
      authority: this.authority,
      permit,
      type: "issue",
    }, this.timeout) as Capability;
  }

  async retire(capability: Capability): Promise<boolean> {
    return await call(this.endpoint, {
      authority: this.authority,
      capability,
      type: "retire",
    }, this.timeout) as boolean;
  }

  async grant(namespace: Namespace, resource: ResourceRequest): Promise<Grant> {
    return await call(this.endpoint, {
      authority: this.authority,
      namespace,
      resource,
      type: "grant",
    }, this.timeout) as Grant;
  }

  async revoke(namespace: Namespace, lease: string, survivors: number[] = []): Promise<Registry> {
    return await call(this.endpoint, {
      authority: this.authority,
      lease,
      namespace,
      survivors,
      type: "revoke",
    }, this.timeout) as Registry;
  }

  async forward(namespace: Namespace, port: string, socket: string): Promise<Registry> {
    return await call(this.endpoint, {
      authority: this.authority,
      namespace,
      port,
      socket,
      type: "forward",
    }, this.timeout) as Registry;
  }

  async resources(namespace: Namespace): Promise<Registry> {
    return await call(this.endpoint, {
      authority: this.authority,
      namespace,
      type: "resources",
    }, this.timeout) as Registry;
  }
}
