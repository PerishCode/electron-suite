import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { decode, type Manifest } from "@perish/release";

export interface Runtime {
  daemon: string;
  data: string;
  manifest: Manifest;
  probe: boolean;
  token: string;
  web: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function runtime(): Runtime {
  const manifest = decode(readFileSync(required("PERISH_RELEASE"), "utf8"));
  return Object.freeze({
    daemon: required("PERISH_DAEMON"),
    data: resolve(required("PERISH_DATA")),
    manifest,
    probe: process.env.PERISH_PROBE === "1",
    token: required("PERISH_TOKEN"),
    web: resolve(required("PERISH_WEB")),
  });
}
