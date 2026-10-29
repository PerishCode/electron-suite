# electron-suite

## Long-term direction

Read [issue #1: Electron product engineering lifecycle](https://github.com/PerishCode/electron-suite/issues/1)
before planning or changing cross-repository architecture.
It records the vision, evidence, ownership boundaries, and completion criteria for
electron-suite and [open-design-slim](https://github.com/PerishCode/open-design-slim).
electron-suite distributes reusable engineering capabilities as npm packages;
open-design-slim consumes published packages and owns product composition and policy.
All workspace packages use the npm scope `@pesuite` (for example, `@pesuite/guard`).
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

- `electron.config.mjs`: optional release identity capability overrides.

## Apps

- `carrier`: platform-installed Electron host.
- `capsule`: independently delivered runtime payload.
- `web`: browser capability fixture.
- `daemon`: background capability fixture.

## Packages

- `blob`: immutable content-addressed artifact storage.
- `config`: typed optional capability entry.
- `guard`: repository structure and source-shape policy authority.
- `pack`: unsigned platform package construction for installation qualification.
- `protocol`: artifact identity, generation contract, and activation state model.
- `publish`: trusted localhost distribution and channel head authority.
- `release`: release identity resolution and manifest authority.
- `sidecar`: capability-scoped process lifecycle reference implementation.
- `testkit`: typed acceptance matrix, qualification runner, and report schema.

## Scripts

- `postinstall.mjs`: topological concurrent workspace build.
- `guard.mjs`: thin `@pesuite/guard` command entry.
- `package.mjs`: thin `@pesuite/pack` platform package entry.
- `acceptance.mjs`: thin `@pesuite/testkit` qualification entry.
