# electron-suite

## Meta rules

- [Issue #1](https://github.com/PerishCode/electron-suite/issues/1) owns the long-term direction and roadmap. Keep it Open until the full lifecycle is proven; use Refs #1 for incremental work.
- suite owns reusable mechanisms and distributes @perishcode npm packages through GitHub Packages; slim consumes fixed published versions and owns composition. Credentials stay in user .npmrc.
- The current scope is four-unit skeletons and mechanism probes. Do not migrate OpenDesign features, business APIs or data models.
- [#10](https://github.com/PerishCode/electron-suite/issues/10) owns sidecar convergence; [#11–#16](https://github.com/PerishCode/electron-suite/issues/1) cover inspect, serve, layered updates and blob. Ownership 0.3 adds exclusive root/namespace authority and fail-closed interruption; live-process restart adoption remains unqualified.
- Public capabilities use pesuite subcommands or explicit package APIs. package.json scripts contain only lint/test/build; the workspace root only dispatches `pnpm -r --if-present run <same-name>`. pnpm has no --if-exists option.
- Modules run their own tools. Do not add install/prepare/pretest/prepack hooks, lifecycle aliases, root callbacks, or scripts directories. Extend policy explicitly when a real capability requires it.
- guard is the engineering-policy authority. Run the relevant build/tests, root lint, direct root Biome check and guard before delivery. Missing execution evidence remains unqualified.

## Directory conventions

- Every directory node must match guard's repository-relative or module-relative allowlist. Parent approval does not approve descendants; this includes hidden, empty and tests directories.
- Authorized patterns permit routine expansion within their declared scope. For a new responsibility or pattern, obtain scope authorization, declare bounded patterns in pesuite.yaml, and update regression coverage and the relevant index. Do not widen patterns, excludes or exceptions just to silence findings. The structure may evolve through this process.
- Generated/dependency/runtime directories have fixed owned boundaries; exclusions do not authorize source or resource trees. Source resources must follow the declared resource lifecycle.

- apps contains runnable reference units; packages contains reusable capabilities. Source belongs in src, tests in sibling tests/**/*.test.ts.
- Brief scale: source <=500 lines; module depth <=5 and width <=8; only configured components paths have a width exemption; styles only in packages/components/**/*.less.
- Modules own source/test tsconfigs and esbuild/Vitest configs. Pin external dependencies to x.y.z and local dependencies to workspace:*; use TS7, Vitest and Biome.
- These summaries aid navigation; the actual guard findings and configuration determine compliance. Root AGENTS.md and README.md are the repository prose entry points.

## Core file index

| File or location                                    | Responsibility                                                           |
| --------------------------------------------------- | ------------------------------------------------------------------------ |
| package.json / pnpm-workspace.yaml / pnpm-lock.yaml | standard dispatch, workspace membership and fixed dependency closure     |
| pesuite.yaml / biome.json                           | guard/runtime declarations and formatter/linter configuration            |
| packages/guard/src/rules/tree.ts / scan/files.ts    | directory allowlists and inspected/pruned boundaries                     |
| packages/guard/src/config/defaults.ts               | policy defaults and rule index                                           |
| packages/cli/src/index.ts / lifecycle.ts            | sole public bin routing; guard/release/pack capabilities                 |
| packages/sidecar/src/runtime/ownership.ts           | persistent exclusive owner records; interrupted/invalid ownership blocks |
| packages/sidecar/src/control / runtime              | hosted methods, resource ownership and management transport              |
| packages/runtime/src/session.ts / capsule.ts        | generation mounting, execution, activation and recovery                  |
| packages/electron/src/host.ts / bridge.ts           | installed host and narrow browser contract                               |
| packages/release / blob / publish / pack            | content identity, CAS, distribution primitives and unsigned packaging    |
| packages/testkit/src/runner.ts / schema.ts          | reference qualification API and evidence schema                          |
| apps/carrier / capsule / web / daemon               | reference runtime units, not product business code                       |
| .github/workflows / .githooks/pre-commit            | CI verification and optional local direct guard hook                     |

## Iteration workflows

### Local environment

Use Node24 and pnpm11.13.0. Configure GitHub Packages credentials in user .npmrc; repository .npmrc contains routing only.
Run `pnpm install --frozen-lockfile`, then explicitly `pnpm build`. Installation does not build the workspace or configure Git hooks.
If desired, enable the tracked hook after building with `git config core.hooksPath .githooks`.

### Local changes and debugging

Use module-scoped `pnpm --filter @perishcode/<module> build|test|lint` while iterating. Build includes source declarations and test type checking.
Never delete authority/registry files to bypass recovery-required errors. Keep the root and evidence for explicit reconciliation.
Hosted control tests are `pnpm --filter @perishcode/sidecar test`; the real Chromium probe is `PERISH_GUI=1 pnpm --filter @perishcode/carrier test` after building.
The unified inspect/serve lifecycle entries are still tracked by #11/#12; do not invent root shortcuts as substitutes.

### Local build and checks

Run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec biome check .`, and `pnpm exec pesuite guard`.
Use `pnpm exec biome check --write .` for formatting. There is no separate typecheck or format script.

### Local end-to-end qualification

Invoke the actual package API from the repository root:

```sh
node --input-type=module -e 'import { run } from "@perishcode/testkit"; const r=await run({root:process.cwd(),output:".artifacts/qualification.json",packaged:process.env.PERISH_PACKAGE==="1"}); if(r.result==="failed") process.exitCode=1;'
```

Set PERISH_PACKAGE=1 on macOS for unsigned installed qualification. Real Chromium has its separate explicit test above; a caller boolean is not evidence. Reports go under .artifacts. Signing, remote feeds and other platform guarantees require separate acceptance.

### Content, package and distribution

After module builds, prepare reference content through the formal capability:

```sh
pnpm exec pesuite release --capsule apps/capsule/dist --daemon apps/daemon/dist --web apps/web/dist --output .artifacts/seed
pnpm exec pesuite pack --carrier apps/carrier/dist --seed .artifacts/seed --output .artifacts/package --receipt .artifacts/package.json
```

These commands do not implicitly compile sources. pack is currently unsigned macOS. The reference carrier is driven by the testkit runtime harness.
For npm delivery, build/check explicitly, run `pnpm --dir packages/<name> pack --pack-destination <absolute-artifact-dir>`, inspect the archive, then publish that archive to GitHub Packages. No prepack hook builds on your behalf.
Record package versions, archive integrity, CI and independent slim registry-consumer results in the owning issue. Keep actual runtime generation separate from npm package versions.
