import type { Config, Context, Provider } from "@perish/config";
import { channel } from "@perish/protocol";

import { parse, type Manifest } from "./manifest.js";

function evaluate(provider: Provider | undefined, fallback: string, context: Readonly<Context>, name: string): string {
  if (!provider) return fallback;
  const first = provider(context);
  const second = provider(context);
  if (first !== second) throw new Error(`${name} must be deterministic`);
  return first;
}

function defaults(context: Readonly<Context>) {
  const stable = context.channel === "stable";
  return {
    appid: stable ? "io.perish.electronsuite" : `io.perish.electronsuite.${context.channel}`,
    name: stable ? "electron-suite" : `electron-suite ${context.channel}`,
    scheme: stable ? "electronsuite" : `electronsuite-${context.channel}`,
  };
}

export function resolve(config: Readonly<Config>, input: Context): Manifest {
  const context = Object.freeze({ channel: channel(input.channel), version: input.version });
  const base = defaults(context);
  const name = evaluate(config.name, base.name, context, "name");
  const scheme = evaluate(config.scheme, base.scheme, context, "scheme");
  const version = evaluate(config.version, context.version, context, "version");
  return parse({
    channel: context.channel,
    identity: {
      appid: base.appid,
      name,
      origin: `${scheme}://carrier`,
      scheme,
      version,
    },
    schema: 1,
  });
}

export function distinct(manifests: Manifest[]): void {
  const fields = ["appid", "name", "scheme"] as const;
  for (const field of fields) {
    const values = manifests.map((item) => item.identity[field].toLowerCase());
    if (new Set(values).size !== values.length) throw new Error(`release ${field} collision`);
  }
  const channels = manifests.map((item) => item.channel);
  if (new Set(channels).size !== channels.length) throw new Error("release channel collision");
}
