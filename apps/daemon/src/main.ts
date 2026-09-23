#!/usr/bin/env node

import { serve } from "./service.js";

const data = process.env.PERISH_DATA;
const origin = process.env.PERISH_ORIGIN;
const socket = process.env.PERISH_SOCKET;
const token = process.env.PERISH_TOKEN;
if (!data || !origin || !socket || !token) throw new Error("daemon resources are required");

const service = await serve({ data, origin, socket, token });
const stop = async () => {
  await service.close();
  process.exitCode = 0;
};

process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
process.stdout.write("ready\n");
