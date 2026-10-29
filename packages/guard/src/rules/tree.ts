import { basename, dirname } from "node:path";
import { rule } from "../config/match.js";
import { owner } from "../scan/modules.js";
import type { Context, Finding } from "../types.js";

export function tree(context: Context): Finding[] {
  const findings: Finding[] = [];
  const children = new Map<string, number>();
  for (const entry of context.entries) {
    const module = owner(entry.path, context.modules);
    if (!module) continue;
    const parent = dirname(entry.path).replaceAll("\\", "/");
    if (owner(parent, context.modules)) children.set(parent, (children.get(parent) ?? 0) + 1);
    if (entry.kind !== "directory") continue;
    const depth =
      entry.path === module.path
        ? 0
        : entry.path.split("/").length - (module.path === "." ? 0 : module.path.split("/").length);
    const limit = rule(context.policy, entry.path, "directory.depth");
    if (limit.enabled && limit.max !== undefined && depth > limit.max)
      findings.push({ path: entry.path, rule: "directory.depth", message: `depth ${depth} exceeds ${limit.max}` });
    if (rule(context.policy, entry.path, "directory.name").enabled && !/^[a-z][a-z0-9]*$/.test(basename(entry.path))) {
      findings.push({ path: entry.path, rule: "directory.name", message: "directory name must be one lowercase word" });
    }
  }
  for (const [path, count] of children) {
    const limit = rule(context.policy, path, "directory.children");
    if (limit.enabled && limit.max !== undefined && !context.policy.components.includes(path) && count > limit.max)
      findings.push({ path, rule: "directory.children", message: `${count} direct children exceeds ${limit.max}` });
  }
  return findings;
}
