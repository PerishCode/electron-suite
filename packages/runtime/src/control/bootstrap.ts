import { join, resolve } from "node:path";
import { channel, namespace } from "@perishcode/protocol";
import { readProduct } from "@perishcode/release";
import { type Attachment, Client, type Factory, managerEndpoint, type Service, serve } from "@perishcode/sidecar";
import { ownerAdapter, type SessionOptions } from "./core.js";

const owners = new WeakMap<
  Bootstrap,
  { host: Service; factory: Factory; electron: Attachment; options: SessionOptions; claimed: boolean }
>();
/** Real Electron bootstrap authority, before product code or binding staging. */
export class Bootstrap {
  private constructor(readonly context: Attachment["context"]) {}
  static async open(options: SessionOptions): Promise<Bootstrap> {
    const host = await serve(managerEndpoint(options.root), { root: options.root });
    try {
      const factory = new Client(host.endpoint, host.authority).factory({
        channel: channel(options.manifest.channel),
        namespace: namespace(options.namespace),
      });
      const state = (await factory.binding()).state;
      const anchor = options.recover
        ? state.current
        : options.candidate || !state.current
          ? (await readProduct(options.candidate ?? options.seed)).envelope.digest
          : state.current;
      if (!anchor) throw new Error("no committed generation to recover");
      const electron = await host.factory(factory.scope).expose<{ quit: { input: null; output: boolean } }>({
        identity: { service: "electron", generation: anchor },
        ...ownerAdapter(options.onQuit),
      });
      const result = new Bootstrap(electron.context);
      owners.set(result, { host, factory, electron, options, claimed: false });
      return result;
    } catch (error) {
      await host.close();
      throw error;
    }
  }
  async close() {
    const state = owners.get(this)!;
    if (state.claimed) throw new Error("bootstrap ownership transferred to Session");
    await state.electron.close();
    await state.host.close();
  }
}
/** Internal ownership transfer, not exported from the package entry. */
export function claim(bootstrap: Bootstrap, options: SessionOptions) {
  const state = owners.get(bootstrap);
  if (
    !state ||
    state.claimed ||
    resolve(state.options.root) !== resolve(options.root) ||
    state.factory.scope.channel !== options.manifest.channel ||
    state.factory.scope.namespace !== options.namespace
  )
    throw new Error("bootstrap ownership mismatch");
  state.claimed = true;
  return state;
}
