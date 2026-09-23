import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

import { encode, parse, type Manifest } from "@perish/release";

export interface Input {
  carrier: string;
  daemon: string;
  manifest: Manifest;
  output: string;
  web: string;
}

export interface Package {
  app: string;
  executable: string;
  resources: string;
}

export interface Plan {
  appId: string;
  executableName: string;
  productName: string;
  version: string;
}

export interface Receipt {
  appid: string;
  version: string;
}

const execute = promisify(execFile);

export function plan(value: Manifest): Plan {
  const manifest = parse(value);
  return {
    appId: manifest.identity.appid,
    executableName: manifest.identity.scheme,
    productName: manifest.identity.name,
    version: manifest.identity.version,
  };
}

function locate(name: "electron" | "electron-builder/out/cli/cli.js"): string {
  return createRequire(import.meta.url).resolve(name);
}

export async function inspect(app: string): Promise<Receipt> {
  if (process.platform !== "darwin") throw new Error("macOS inspection requires darwin");
  const plist = join(resolve(app), "Contents", "Info.plist");
  const [appid, version] = await Promise.all([
    execute("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleIdentifier", plist]),
    execute("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleShortVersionString", plist]),
  ]);
  return { appid: appid.stdout.trim(), version: version.stdout.trim() };
}

export async function pack(input: Input): Promise<Package> {
  if (process.platform !== "darwin") throw new Error("macOS package requires darwin");
  const manifest = parse(input.manifest);
  const identity = plan(manifest);
  const temporary = await mkdtemp(join(tmpdir(), "perish-pack-"));
  const output = resolve(input.output);
  const release = join(temporary, "release.json");
  const electron = dirname(locate("electron"));
  const metadata = {
    author: "PerishCode",
    description: "electron-suite platform carrier",
    main: "dist/main.mjs",
    name: manifest.identity.appid.replaceAll(".", "-"),
    productName: identity.productName,
    version: identity.version,
  };
  const config = {
    appId: identity.appId,
    asar: true,
    directories: { output },
    electronDist: join(electron, "dist"),
    electronVersion: JSON.parse(await readFile(join(electron, "package.json"), "utf8")).version,
    executableName: identity.executableName,
    extraMetadata: metadata,
    extraResources: [
      { from: resolve(input.daemon), to: "daemon" },
      { from: release, to: "release.json" },
      { from: resolve(input.web), to: "web" },
    ],
    files: ["dist/**/*", "package.json"],
    mac: {
      gatekeeperAssess: false,
      hardenedRuntime: false,
      identity: null,
      notarize: false,
      target: ["dir"],
    },
    nodeGypRebuild: false,
    npmRebuild: false,
    productName: identity.productName,
    protocols: [{ name: identity.productName, schemes: [manifest.identity.scheme] }],
  };

  try {
    await cp(resolve(input.carrier), join(temporary, "dist"), { recursive: true });
    await writeFile(join(temporary, "package.json"), `${JSON.stringify(metadata)}\n`);
    await writeFile(release, encode(manifest));
    await writeFile(join(temporary, "builder.json"), `${JSON.stringify(config)}\n`);
    await rm(output, { force: true, recursive: true });
    await mkdir(output, { recursive: true });
    await execute(process.execPath, [
      locate("electron-builder/out/cli/cli.js"),
      "--mac",
      "--projectDir",
      temporary,
      "--config",
      join(temporary, "builder.json"),
      "--publish",
      "never",
    ]);
    const app = join(output, `mac-${process.arch}`, `${identity.executableName}.app`);
    const resources = join(app, "Contents", "Resources");
    return {
      app,
      executable: join(app, "Contents", "MacOS", identity.executableName),
      resources,
    };
  } finally {
    await rm(temporary, { force: true, recursive: true });
  }
}
