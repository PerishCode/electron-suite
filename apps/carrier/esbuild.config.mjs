import { build } from "esbuild";

const shared = {
  bundle: true,
  external: ["electron"],
  platform: "node",
  target: "node24",
};

await Promise.all([
  build({ ...shared, entryPoints: ["src/index.ts"], format: "esm", outfile: "dist/index.mjs" }),
  build({ ...shared, entryPoints: ["src/main.ts"], format: "esm", outfile: "dist/main.mjs" }),
  build({ ...shared, entryPoints: ["src/preload.ts"], format: "cjs", outfile: "dist/preload.cjs" }),
]);
