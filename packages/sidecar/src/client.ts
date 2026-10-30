import type {
  Capability,
  Channel,
  Event,
  Grant,
  Namespace,
  Permit,
  Registry,
  Request as ResourceRequest,
} from "@perishcode/protocol";
import type { Change, Journal } from "./binding.js";
import type { Directory } from "./control/directory.js";
import { Peer } from "./control/peer.js";
import type { Identity } from "./control/types.js";
import type { Lease, Release, Snapshot, Spec } from "./host.js";
import { call } from "./runtime/transport.js";

export class Client {
  constructor(
    readonly endpoint: string,
    readonly authority: string,
    readonly timeout = 5000,
  ) {}

  async connect<Methods>(identity: Identity): Promise<Peer<Methods>> {
    const descriptor = await call(
      this.endpoint,
      { authority: this.authority, identity, type: "connect" },
      this.timeout,
    );
    return new Peer<Methods>(this.endpoint, descriptor, this.timeout);
  }

  async start(spec: Spec): Promise<Lease> {
    return (await call(
      this.endpoint,
      {
        authority: this.authority,
        spec,
        type: "start",
      },
      this.timeout,
    )) as Lease;
  }

  async attach(lease: Lease): Promise<Lease> {
    return (await call(this.endpoint, { lease, type: "attach" }, this.timeout)) as Lease;
  }

  async release(lease: Lease): Promise<Release> {
    return (await call(this.endpoint, { lease, type: "release" }, this.timeout)) as Release;
  }

  async directory(namespace: Namespace): Promise<Directory> {
    return (await call(
      this.endpoint,
      { authority: this.authority, namespace, type: "directory" },
      this.timeout,
    )) as Directory;
  }

  async inspect(): Promise<Snapshot[]> {
    return (await call(
      this.endpoint,
      {
        authority: this.authority,
        type: "inspect",
      },
      this.timeout,
    )) as Snapshot[];
  }

  async binding(namespace: Namespace, channel: Channel): Promise<Journal> {
    return (await call(
      this.endpoint,
      {
        authority: this.authority,
        channel,
        namespace,
        type: "binding",
      },
      this.timeout,
    )) as Journal;
  }

  async transit(namespace: Namespace, channel: Channel, revision: number, event: Event): Promise<Change> {
    return (await call(
      this.endpoint,
      {
        authority: this.authority,
        channel,
        event,
        namespace,
        revision,
        type: "transit",
      },
      this.timeout,
    )) as Change;
  }

  async issue(permit: Permit): Promise<Capability> {
    return (await call(
      this.endpoint,
      {
        authority: this.authority,
        permit,
        type: "issue",
      },
      this.timeout,
    )) as Capability;
  }

  async retire(capability: Capability): Promise<boolean> {
    return (await call(
      this.endpoint,
      {
        authority: this.authority,
        capability,
        type: "retire",
      },
      this.timeout,
    )) as boolean;
  }

  async grant(namespace: Namespace, resource: ResourceRequest): Promise<Grant> {
    return (await call(
      this.endpoint,
      {
        authority: this.authority,
        namespace,
        resource,
        type: "grant",
      },
      this.timeout,
    )) as Grant;
  }

  async revoke(namespace: Namespace, lease: string, survivors: number[] = []): Promise<Registry> {
    return (await call(
      this.endpoint,
      {
        authority: this.authority,
        lease,
        namespace,
        survivors,
        type: "revoke",
      },
      this.timeout,
    )) as Registry;
  }

  async forward(namespace: Namespace, port: string, socket: string): Promise<Registry> {
    return (await call(
      this.endpoint,
      {
        authority: this.authority,
        namespace,
        port,
        socket,
        type: "forward",
      },
      this.timeout,
    )) as Registry;
  }

  async resources(namespace: Namespace): Promise<Registry> {
    return (await call(
      this.endpoint,
      {
        authority: this.authority,
        namespace,
        type: "resources",
      },
      this.timeout,
    )) as Registry;
  }
}
