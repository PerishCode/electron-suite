import { readFile } from "node:fs/promises";
import { type Manifest, parse as manifest } from "@perishcode/release";
import { parse } from "yaml";

export interface Settings {
  carrier: number;
  manifest: Manifest;
  namespace: string;
}

export async function settings(path: string): Promise<Settings> {
  const document = parse(await readFile(path, "utf8")) as Record<string, unknown>;
  if (document?.schemaVersion !== 1) throw new Error("pesuite.schemaVersion must be 1");
  const value = document.runtime as Record<string, unknown> | undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("pesuite.runtime is required");
  const allowed = ["appid", "carrier", "channel", "name", "namespace", "scheme", "version"];
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error("unknown runtime setting");
  for (const key of allowed.filter((key) => key !== "carrier")) {
    if (typeof value[key] !== "string" || !value[key]) throw new Error(`runtime.${key} is required`);
  }
  if (!/^[a-z][a-z0-9]*$/.test(String(value.namespace))) throw new Error("invalid runtime namespace");
  if (!Number.isSafeInteger(value.carrier) || Number(value.carrier) < 1) throw new Error("invalid carrier ABI");
  return {
    carrier: Number(value.carrier),
    namespace: String(value.namespace),
    manifest: manifest({
      channel: value.channel,
      identity: {
        appid: value.appid,
        name: value.name,
        origin: `${value.scheme}://carrier`,
        scheme: value.scheme,
        version: value.version,
      },
      schema: 1,
    }),
  };
}
