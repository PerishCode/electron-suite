export const policy = {
  children: 10,
  exact: new Set([
    ".githooks/pre-commit",
    "AGENTS.md",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
  ]),
  indent: {
    levels: 4,
    width: 2,
  },
  lines: {
    script: 200,
    source: 500,
  },
  prose: new Set(["md", "mdx", "rst", "txt"]),
  roles: new Set(["config", "d", "test", "tests"]),
  source: new Set(["cjs", "js", "mjs", "ts", "tsx"]),
  text: new Set(["cjs", "js", "json", "mjs", "ts", "tsx", "yaml", "yml"]),
} as const;
