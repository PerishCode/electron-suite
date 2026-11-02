import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { guard } from "@perishcode/guard";
import { inspect } from "@perishcode/pack";
import { parseDocument } from "yaml";
import { loadBuild, loadPackage } from "./build.js";
import { channelRoot, configuration } from "./config.js";
import { execute, json, located, run } from "./files.js";
import type { CheckReceipt, Gate } from "./types.js";

export const gates: Gate[] = ["policy", "tests", "artifacts", "installed"];
function alive(pid: unknown): boolean {
  if (!Number.isSafeInteger(pid) || Number(pid) < 1) throw new Error("invalid probe PID");
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (fault) {
    if ((fault as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw fault;
  }
}
export async function check(
  root: string,
  lane: string,
  gate: Gate,
  platform?: string,
  arch?: string,
): Promise<CheckReceipt> {
  if (!gates.includes(gate)) throw new Error("unknown quality gate");
  const config = await configuration(root, lane);
  root = config.root;
  const build = await loadBuild(root, lane);
  const receipt: CheckReceipt = {
    schema: 1,
    gate,
    channel: lane,
    result: "failed",
    source: build.source,
    fingerprint: build.fingerprint,
    details: null,
  };
  try {
    if (gate === "policy") {
      await validateWorkflows(root);
      const report = await guard({ root });
      if (!report.ok) throw new Error("guard findings block policy gate");
      await run(root, ["-r", "--if-present", "run", "lint"]);
      await run(root, ["exec", "biome", "check", "."]);
      receipt.details = { files: report.files };
    } else if (gate === "tests") {
      await run(root, ["-r", "--if-present", "run", "test"]);
      receipt.details = { command: "pnpm -r --if-present run test" };
    } else {
      const packaged = await loadPackage(root, lane, platform, arch);
      receipt.artifact = packaged.artifact.sha256;
      if (gate === "artifacts") receipt.details = { archive: packaged.artifact.sha256, inventory: packaged.inventory };
      else {
        if (packaged.platform !== "mac" || process.platform !== "darwin")
          throw new Error("installed SDK probe currently requires macOS");
        const native = await inspect(await located(root, packaged.package.app));
        if (native.appid !== build.manifest.identity.appid || native.version !== build.version)
          throw new Error("native installed identity mismatch");
        const base = join(channelRoot(root, lane), "checks", `installed-${Date.now()}`);
        const launches: unknown[] = [];
        for (const name of ["initial", "cold"]) {
          const path = join(base, `${name}.json`);
          const execution = execute(await located(root, packaged.package.executable), [], {
            cwd: root,
            timeout: 30000,
            maxBuffer: 4 * 1024 * 1024,
            env: { ...process.env, PESUITE_DATA: join(base, "state"), PESUITE_PROBE: "1", PESUITE_RECEIPT: path },
          });
          const pid = execution.child.pid;
          await execution;
          const observed = JSON.parse(await readFile(path, "utf8"));
          const stop = JSON.parse(await readFile(`${path}.stop.json`, "utf8"));
          if (
            observed.pid !== pid ||
            observed.generation !== build.generation ||
            observed.daemon?.generation !== build.generation ||
            !observed.nonce ||
            observed.nonce !== observed.daemon?.nonce ||
            !observed.capsule ||
            !observed.renderer ||
            stop.status !== "stopped" ||
            !Array.isArray(stop.survivors) ||
            stop.survivors.length ||
            alive(pid) ||
            alive(observed.daemon?.pid)
          )
            throw new Error("installed lifecycle evidence mismatch");
          launches.push({
            name,
            pid,
            daemonPid: observed.daemon.pid,
            generation: observed.generation,
            nonce: observed.nonce,
            stopped: true,
          });
        }
        receipt.details = { native, launches, signing: "unqualified", remoteUpdates: "unqualified" };
      }
    }
    receipt.result = "passed";
    return receipt;
  } finally {
    await json(join(channelRoot(root, lane), "checks", `${gate}.json`), receipt);
  }
}

/** Shape validation is shared; workflow authors still choose all quality gates. */
export async function validateWorkflows(root: string): Promise<Record<string, string[]>> {
  const found: Record<string, string[]> = {};
  for (const name of ["stable.release.yml", "channel.release.yml"]) {
    let raw: string;
    try {
      raw = await readFile(join(root, ".github/workflows", name), "utf8");
    } catch (fault) {
      if ((fault as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw fault;
    }
    const doc = parseDocument(raw, { uniqueKeys: true });
    if (doc.errors.length) throw new Error("invalid release workflow YAML");
    const workflow = doc.toJS({ maxAliasCount: 0 }) as {
      jobs?: Record<string, { steps?: { run?: unknown; uses?: unknown }[] }>;
    };
    if (!workflow.jobs || !Object.keys(workflow.jobs).length) throw new Error("release workflow needs jobs");
    found[name] = [];
    for (const job of Object.values(workflow.jobs)) {
      if (!Array.isArray(job.steps)) throw new Error("release jobs must declare explicit steps");
      for (const step of job.steps) {
        if (
          step.run !== undefined &&
          (typeof step.run !== "string" ||
            step.run.length > 256 ||
            !/^(?:pnpm exec pesuite [a-z]+(?: .*?)?|pnpm install --frozen-lockfile)$/.test(step.run) ||
            /[\r\n;|&`<>]|\$\(|\$\{\{/.test(step.run))
        )
          throw new Error("release workflow run must be one short pesuite invocation");
        if (typeof step.run === "string") found[name]?.push(step.run);
        if (typeof step.uses === "string" && step.uses.startsWith("./"))
          throw new Error("release workflow cannot hide implementation in local actions");
      }
    }
  }
  return found;
}
