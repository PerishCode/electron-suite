# electron-suite

## Long-term direction

Read [issue #1: Electron product engineering lifecycle](https://github.com/PerishCode/electron-suite/issues/1)
before planning or changing cross-repository architecture.
It records the vision, evidence, ownership boundaries, and completion criteria for
electron-suite and [open-design-slim](https://github.com/PerishCode/open-design-slim).
electron-suite distributes reusable engineering capabilities as npm packages;
open-design-slim consumes published packages and owns product composition and policy.
All workspace packages use the personal npm scope `@perishcode` (for example, `@perishcode/guard`).
Publish to GitHub Packages. Repository `.npmrc` contains only scope routing; credentials belong in user configuration.
Expose CLI capabilities only through `pesuite <command>`; guard is `pesuite guard`.
Repository configuration lives in `pesuite.yaml`, with guard settings under `guard`.
Read [issue #3](https://github.com/PerishCode/electron-suite/issues/3) for guard delivery and acceptance.
Link incremental work and validation evidence to issue #1 using `Refs #1`.
Keep it Open until the full product lifecycle and recorded completion criteria are
fulfilled with reviewable evidence. Partial deliveries must not close it; do not
use automatic closing keywords for this issue.

## Workspace

- `apps/`: runnable applications.
- `packages/`: shared capabilities and tooling.
- `pnpm-workspace.yaml`: workspace membership for `apps/*` and `packages/*`.
- `README.md`: project introduction, repository layout, and local commands.
- `AGENTS.md`: repository conventions and capability index for agents.

Keep application code in `apps/` and reusable capabilities in `packages/`.
Use pnpm from the repository root. Follow the user's instructions incrementally.
`AGENTS.md` and `README.md` at the repository root are the allowed prose files.

## Config

- `pesuite.yaml`: versioned repository policy overrides; no `guard.yaml` fallback.
- `biome.json`: formatting, lint, and import organization policy.
- `electron.config.mjs`: optional release identity capability overrides.

## Engineering rules

- Each workspace package is a module; its root is depth 0, `src` and `tests` are depth 1.
- Source files, including tests, contain at most 500 physical lines including blanks and comments.
- Module directory depth is at most 5 and direct child count at most 8.
- Exact configured components paths are exempt from width only, never depth or file rules.
- Only `packages/components/**/*.less` may define stylesheets. Other source must not define styles.
- Keep source in `src` and tests in `tests/**/*.test.ts`; neither tree is exempt from directory rules.
- Modules own `tsconfig.json` and `tsconfig.tests.json`; tests declare `@` pointing to `./src`.
- Use TypeScript 7, Vitest, and Biome. External dependencies use exact `x.y.z`; internal dependencies use `workspace:*`.
- Run `pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm guard` before delivery.

## Apps

- `carrier`: platform-installed Electron host.
- `capsule`: independently delivered runtime payload.
- `web`: browser capability fixture.
- `daemon`: background capability fixture.

## Packages

- `blob`: immutable content-addressed artifact storage.
- `config`: typed optional capability entry.
- `guard`: repository structure and source-shape policy authority.
- `cli`: the sole `pesuite` bin and command routing; consumes guard without duplicating rules.
- `pack`: unsigned platform package construction for installation qualification.
- `protocol`: artifact identity, generation contract, and activation state model.
- `publish`: trusted localhost distribution and channel head authority.
- `release`: release identity resolution and manifest authority.
- `sidecar`: capability-scoped process lifecycle reference implementation.
- `testkit`: typed acceptance matrix, qualification runner, and report schema.

## Scripts

- `postinstall.mjs`: topological concurrent workspace build.
- `package.mjs`: thin `@perishcode/pack` platform package entry.
- `acceptance.mjs`: thin `@perishcode/testkit` qualification entry.
