import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { inspect, type Finding } from "./inspect.js";

export { inspect } from "./inspect.js";
export type { Finding, InspectOptions } from "./inspect.js";
export { policy } from "./policy.js";

export interface GuardOptions {
  root: string;
  staged?: boolean;
}

export interface Report {
  findings: Finding[];
  mode: "full" | "staged";
  ok: boolean;
  paths: number;
}

const execute = promisify(execFile);

async function git(root: string, args: string[]): Promise<string[]> {
  const { stdout } = await execute("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });

  return stdout.split("\0").filter(Boolean);
}

async function present(root: string, paths: string[]): Promise<string[]> {
  const states = await Promise.all(paths.map(async (path) => {
    try {
      await access(join(root, path));
      return path;
    } catch {
      return undefined;
    }
  }));

  return states.filter((path): path is string => path !== undefined);
}

export async function guard(options: GuardOptions): Promise<Report> {
  const listed = await git(options.root, [
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "-z",
  ]);
  const paths = await present(options.root, listed);
  const targets = options.staged
    ? new Set(await git(options.root, [
      "diff",
      "--cached",
      "--name-only",
      "--diff-filter=ACMR",
      "-z",
    ]))
    : undefined;
  const findings = await inspect({ paths, root: options.root, targets });

  return {
    findings,
    mode: options.staged ? "staged" : "full",
    ok: findings.length === 0,
    paths: targets?.size ?? paths.length,
  };
}

export function format(report: Report, json = false): string {
  if (json) {
    return JSON.stringify(report, null, 2);
  }

  const summary = `guard ${report.mode}: ${report.ok ? "ok" : "failed"} (${report.paths} files)`;
  const findings = report.findings.map((item) =>
    `${item.path}: ${item.message} [${item.rule}]`,
  );

  return [summary, ...findings].join("\n");
}
