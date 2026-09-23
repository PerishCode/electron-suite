# electron-suite

`AGENTS.md` is the only non-structured source file in this repository.

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
- `guard.mjs`: thin `@perish/guard` command entry.
- `package.mjs`: thin `@perish/pack` platform package entry.
- `acceptance.mjs`: thin `@perish/testkit` qualification entry.
