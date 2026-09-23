#!/usr/bin/env node

import { serve } from "./server.js";

const endpoint = process.env.PERISH_SIDECAR_ENDPOINT;
const authority = process.env.PERISH_SIDECAR_AUTHORITY;

if (!endpoint || !authority) {
  throw new Error("sidecar endpoint and authority are required");
}

const service = await serve(endpoint, undefined, authority);
const stop = async () => {
  await service.close();
  process.exitCode = 0;
};

process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
process.stdout.write("ready\n");
