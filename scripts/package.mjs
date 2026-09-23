import { join } from "node:path";

import { pack } from "@perish/pack";
import { resolve } from "@perish/release";

import config from "../electron.config.mjs";

const root = process.cwd();
const channel = process.env.PERISH_CHANNEL ?? "stable";
const version = process.env.PERISH_VERSION ?? "1.0.0";
const result = await pack({
  carrier: join(root, "apps/carrier/dist"),
  daemon: join(root, "apps/daemon/dist"),
  manifest: resolve(config, { channel, version }),
  output: join(root, ".artifacts/package", channel),
  web: join(root, "apps/web/dist"),
});

process.stdout.write(`${JSON.stringify(result)}\n`);
