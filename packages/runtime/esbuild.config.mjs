import { build } from "esbuild";

await build({
  bundle: true,
  entryPoints: { index: "src/index.ts", settings: "src/settings.ts" },
  format: "esm",
  outdir: "dist",
  outExtension: { ".js": ".mjs" },
  packages: "external",
  platform: "node",
  target: "node24",
});
