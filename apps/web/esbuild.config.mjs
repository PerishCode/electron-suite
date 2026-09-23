import { copyFile, mkdir } from "node:fs/promises";

import { build } from "esbuild";

const shared = {
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2024",
};

await mkdir("dist", { recursive: true });
await Promise.all([
  build({ ...shared, entryPoints: ["src/index.ts"], outfile: "dist/index.mjs" }),
  build({ ...shared, entryPoints: ["src/main.ts"], outfile: "dist/main.js" }),
  copyFile("index.html", "dist/index.html"),
]);
