import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

import { policy } from "./policy.js";

export interface Finding {
  message: string;
  path: string;
  rule: string;
}

export interface InspectOptions {
  paths: string[];
  root: string;
  targets?: Set<string>;
}

const word = /^[a-z][a-z0-9]*$/;
const workspace = /^(apps|packages)\/[^/]+\//;
const app = /^apps\/[^/]+\/package\.json$/;

function finding(path: string, rule: string, message: string): Finding {
  return { message, path, rule };
}

function ancestors(path: string): string[] {
  const parts = path.split("/");

  return parts.slice(0, -1).map((_, index) =>
    parts.slice(0, index + 1).join("/"),
  );
}

function affected(path: string, targets?: Set<string>): boolean {
  if (!targets) {
    return true;
  }

  if (targets.has(path)) {
    return true;
  }

  return [...targets].some((target) => ancestors(target).includes(path));
}

function inspectName(path: string): Finding[] {
  if (policy.exact.has(path)) {
    return [];
  }

  return path.split("/").flatMap((segment) => {
    const parts = segment.replace(/^\./, "").split(".");
    const stem = parts.at(0) ?? "";
    const roles = parts.slice(1, -1);

    if (!word.test(stem) || roles.some((role) => !policy.roles.has(role))) {
      return [finding(path, "name.word", `${segment} is not a single-word name`)];
    }

    return [];
  });
}

function lines(content: string): string[] {
  const rows = content.split(/\r?\n/);

  if (rows.at(-1) === "") {
    rows.pop();
  }

  return rows;
}

function inspectScript(path: string, content: string): Finding[] {
  const findings: Finding[] = [];

  if (path.split("/").length !== 2) {
    findings.push(finding(path, "script.flat", "scripts must not contain directories"));
  }

  if (extname(path) !== ".mjs") {
    findings.push(finding(path, "script.module", "scripts must use .mjs"));
  }

  if (/\b(class|export|function)\b/.test(content)) {
    findings.push(finding(path, "script.structure", "reusable structure belongs in a package"));
  }

  if (lines(content).length > policy.lines.script) {
    findings.push(finding(path, "script.lines", `scripts are limited to ${policy.lines.script} lines`));
  }

  return findings;
}

function inspectSource(path: string, content: string): Finding[] {
  const findings: Finding[] = [];
  const rows = lines(content);

  if (workspace.test(path) && rows.length > policy.lines.source) {
    findings.push(finding(path, "source.lines", `source files are limited to ${policy.lines.source} lines`));
  }

  if (policy.source.has(extname(path).slice(1))) {
    const limit = policy.indent.levels * policy.indent.width;
    const row = rows.findIndex((value) => {
      const prefix = value.match(/^[ \t]*/)?.at(0) ?? "";
      return prefix.replaceAll("\t", " ".repeat(policy.indent.width)).length > limit;
    });

    if (row >= 0) {
      findings.push(finding(path, "source.indent", `line ${row + 1} exceeds ${policy.indent.levels} levels`));
    }
  }

  return findings;
}

function inspectVersion(path: string, content: string): Finding[] {
  if (!app.test(path)) return [];
  try {
    const value = JSON.parse(content) as { version?: unknown };
    if (value.version === "0.0.0") return [];
  } catch {
    return [finding(path, "app.version", "app package must be valid JSON with version 0.0.0")];
  }
  return [finding(path, "app.version", "app package version must be 0.0.0")];
}

function inspectChildren(paths: string[], targets?: Set<string>): Finding[] {
  const children = new Map<string, Set<string>>();

  for (const path of paths.filter((value) => workspace.test(value))) {
    const parts = path.split("/");

    for (let index = 2; index < parts.length; index += 1) {
      const parent = parts.slice(0, index).join("/");
      const entries = children.get(parent) ?? new Set<string>();
      entries.add(parts[index] ?? "");
      children.set(parent, entries);
    }
  }

  return [...children.entries()].flatMap(([path, entries]) => {
    if (entries.size <= policy.children || !affected(path, targets)) {
      return [];
    }

    return [finding(path, "directory.children", `directory has ${entries.size} direct children; limit is ${policy.children}`)];
  });
}

export async function inspect(options: InspectOptions): Promise<Finding[]> {
  const findings = inspectChildren(options.paths, options.targets);

  for (const path of options.paths) {
    if (!affected(path, options.targets)) {
      continue;
    }

    findings.push(...inspectName(path));
    const extension = extname(path).slice(1);

    if (policy.prose.has(extension) && path !== "AGENTS.md") {
      findings.push(finding(path, "source.prose", "AGENTS.md is the only non-structured source"));
    }

    if (!policy.text.has(extension)) {
      continue;
    }

    const content = await readFile(join(options.root, path), "utf8");
    findings.push(...inspectSource(path, content));
    findings.push(...inspectVersion(path, content));

    if (path.startsWith("scripts/")) {
      findings.push(...inspectScript(path, content));
    }
  }

  return findings.sort((left, right) =>
    `${left.path}:${left.rule}`.localeCompare(`${right.path}:${right.rule}`),
  );
}
