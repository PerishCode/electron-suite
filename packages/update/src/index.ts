import { Store } from "@perishcode/blob";
import { canonical, type Digest, type Envelope, type Pointer, verify } from "@perishcode/protocol";
import { Feed, type Release } from "@perishcode/publish";
import type { Attachment, Expose } from "@perishcode/sidecar";

export interface Host {
  content(): Promise<Release>;
  expose<M>(service: string, options: Omit<Expose<M>, "identity">): Promise<Attachment>;
}
export interface Status {
  current: Digest;
  phase: "idle" | "checking" | "prepared" | "failed" | "stopped";
  checks: number;
  revision?: number;
  prepared?: { target: Digest; changed: ("web" | "daemon")[] };
  error?: string;
}
export interface Methods {
  status: { input: unknown; output: Status };
}
export async function watch(
  host: Host,
  options: { endpoint: string; publickey: string; intervalMs?: number; timeoutMs?: number; maxBytes?: number },
) {
  const interval = options.intervalMs ?? 5000;
  if (!Number.isSafeInteger(interval) || interval < 50 || interval > 3600000)
    throw new Error("invalid discovery interval");
  const initial = await host.content();
  const feed = new Feed(options.endpoint, options.publickey, options);
  let state: Status = { current: initial.envelope.digest, phase: "idle", checks: 0 };
  let pending: Promise<void> | undefined;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  let store: Store;
  let lane: Parameters<Feed["head"]>[0];
  let observed: { revision: number; head?: Pointer } | undefined;
  let prepared: Envelope | undefined;
  const status = (): Status => structuredClone(state);
  const check = (): Promise<void> => {
    if (stopped) return Promise.reject(new Error("discovery is stopped"));
    if (pending) return pending;
    const abort = new AbortController();
    controller = abort;
    state = { ...state, phase: "checking", checks: state.checks + 1, error: undefined };
    const execute = async () => {
      try {
        const head = await feed.head(lane, abort.signal);
        if (
          observed &&
          (head.revision < observed.revision ||
            (head.revision === observed.revision && canonical(head.head ?? null) !== canonical(observed.head ?? null)))
        )
          throw new Error("distribution revision regressed or conflicted");
        observed = head;
        state.revision = head.revision;
        if (!head.head || head.head.generation === initial.envelope.digest) {
          prepared = undefined;
          state = { ...state, phase: "idle", prepared: undefined };
          return;
        }
        const release = await feed.release(lane, head.head, {
          signal: abort.signal,
          cached: async (artifact) => ((await store.has(artifact)) ? store.read(artifact) : undefined),
        });
        const before = initial.envelope.generation,
          after = release.envelope.generation;
        if (
          before.carrier !== after.carrier ||
          canonical(before.capsule) !== canonical(after.capsule) ||
          canonical(before.blobs) !== canonical(after.blobs)
        )
          throw new Error("candidate requires capsule, blob or carrier update");
        const changed = (["web", "daemon"] as const).filter(
          (kind) => canonical(before[kind]) !== canonical(after[kind]),
        );
        if (!changed.length) throw new Error("leaf candidate has no changed units");
        for (const asset of release.assets) {
          abort.signal.throwIfAborted();
          if (!verify(asset.artifact, asset.bytes)) throw new Error("candidate integrity mismatch");
          await store.put(asset.artifact.kind, asset.artifact.slot, asset.bytes);
        }
        abort.signal.throwIfAborted();
        prepared = release.envelope;
        state = { ...state, phase: "prepared", prepared: { target: prepared.digest, changed: [...changed] } };
      } catch (error) {
        if (!stopped) state = { ...state, phase: "failed", error: String(error).slice(0, 1000) };
      }
    };
    pending = execute().finally(() => {
      pending = undefined;
      controller = undefined;
    });
    return pending;
  };
  const schedule = async () => {
    await check();
    if (!stopped)
      timer = setTimeout(() => {
        void schedule();
      }, interval);
  };
  const attachment = await host.expose<Methods>("updates", {
    handlers: { status },
    lifecycle: {
      initialize: async (context) => {
        lane = context.identity.channel;
        if (context.identity.generation !== initial.envelope.digest)
          throw new Error("discovery host generation mismatch");
        store = await Store.open({ root: context.roots.resource });
        for (const asset of initial.assets) {
          if (!verify(asset.artifact, asset.bytes)) throw new Error("initial content integrity mismatch");
          await store.put(asset.artifact.kind, asset.artifact.slot, asset.bytes);
        }
        // Start after initialize returns, so service publication precedes polling.
        timer = setTimeout(() => {
          void schedule();
        }, 0);
      },
      stop: async () => {
        stopped = true;
        clearTimeout(timer);
        controller?.abort(new Error("discovery stopped"));
        await pending;
        state = { ...state, phase: "stopped" };
      },
    },
  });
  return {
    status,
    check,
    close: () => attachment.close(),
    candidate: async (): Promise<Release | undefined> => {
      if (stopped) throw new Error("discovery is stopped");
      const value = prepared ? structuredClone(prepared) : undefined;
      if (!value || state.phase !== "prepared") return undefined;
      const g = value.generation;
      return {
        envelope: value,
        assets: await Promise.all(
          [g.capsule, g.daemon, g.web, ...g.blobs].map(async (artifact) => ({
            artifact,
            bytes: await store.read(artifact),
          })),
        ),
      };
    },
  };
}
