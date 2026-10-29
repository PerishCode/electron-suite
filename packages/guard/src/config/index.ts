import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseDocument } from "yaml";
import type { Exception, Override, Policy } from "../types.js";
import { defaults } from "./defaults.js";
import { object, rules, strings } from "./schema.js";

export function configuration(input: unknown): Policy {
  const policy = structuredClone(defaults);
  if (input === null || input === undefined) return policy;
  const top = object(input, ["schemaVersion", "guard", "runtime"], "pesuite");
  if (top.schemaVersion !== 1) throw new Error("pesuite.schemaVersion must be 1");
  if (!("guard" in top)) return policy;
  const guard = object(
    top.guard,
    ["exclude", "modules", "components", "names", "rules", "overrides", "exceptions"],
    "guard",
  );
  for (const name of ["exclude", "modules", "components", "names"] as const) {
    if (name in guard) policy[name] = strings(guard[name], `guard.${name}`, name !== "names");
  }
  if ("modules" in guard) policy.workspace = false;
  if (policy.components.some((path) => path.includes("*"))) throw new Error("guard.components requires exact paths");
  if (guard.rules !== undefined) {
    for (const [name, value] of Object.entries(rules(guard.rules))) {
      const base = policy.rules[name];
      if (!base) throw new Error(`unknown rule: ${name}`);
      policy.rules[name] = { ...base, ...value };
    }
  }
  if (guard.overrides !== undefined) policy.overrides = list(guard.overrides, "overrides").map(override);
  if (guard.exceptions !== undefined) policy.exceptions = list(guard.exceptions, "exceptions").map(exception);
  return policy;
}

function list(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`guard.${label} must be an array`);
  return value;
}

function override(value: unknown): Override {
  const data = object(value, ["paths", "rules"], "override");
  const paths = strings(data.paths, "override.paths");
  if (!paths.length) throw new Error("override.paths must not be empty");
  return { paths, rules: rules(data.rules) };
}

function exception(value: unknown): Exception {
  const data = object(value, ["paths", "rules", "reason"], "exception");
  const paths = strings(data.paths, "exception.paths");
  const names = strings(data.rules, "exception.rules", false);
  if (!paths.length || !names.length || names.some((name) => !Object.hasOwn(defaults.rules, name)))
    throw new Error("exception requires paths and known rules");
  if (typeof data.reason !== "string" || !data.reason.trim()) throw new Error("exception.reason must not be empty");
  return { paths, rules: names, reason: data.reason };
}

export async function load(root: string): Promise<Policy> {
  let content: string;
  try {
    if (!(await lstat(join(root, "pesuite.yaml"))).isFile()) throw new Error("pesuite.yaml must be a regular file");
    content = await readFile(join(root, "pesuite.yaml"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return configuration(undefined);
    throw error;
  }
  const document = parseDocument(content, { uniqueKeys: true, schema: "core" });
  if (document.errors.length || document.warnings.length)
    throw new Error(
      `pesuite.yaml: ${[...document.errors, ...document.warnings].map((error) => error.message).join("; ")}`,
    );
  return configuration(document.toJS({ maxAliasCount: 0 }));
}
