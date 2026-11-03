# electron-suite

## Meta rules

- [Issue #1](https://github.com/PerishCode/electron-suite/issues/1) owns the long-term direction and roadmap. Keep it Open until the full lifecycle is proven; use Refs #1 for incremental work.
- suite owns reusable mechanisms and distributes @perishcode npm packages through GitHub Packages; slim consumes fixed published versions and owns composition. Credentials stay in user .npmrc.
- The current scope is four-unit skeletons and mechanism probes. Do not migrate OpenDesign features, business APIs or data models.
- [#10](https://github.com/PerishCode/electron-suite/issues/10) owns sidecar convergence; [#11–#16](https://github.com/PerishCode/electron-suite/issues/1) cover inspect, serve, layered updates and blob. Sidecar 2.0 binds stamped supervisors and allocator/registry/instance/session/binding management to channel+namespace factories. Only the current stamped format is accepted. Explicit dead-owner recovery is tracked by #56; unfinished sessions retain controller PID/birth witnesses and refuse recovery while those controllers live; instance/resource-use edges and live-process adoption remain separate.
- [#28](https://github.com/PerishCode/electron-suite/issues/28) owns channel-model correction. Channel is product distribution identity; channel + namespace determines the resource factory. Factory delivery is tracked by #30; distribution tooling shipped in #32; #38 owns the published four-unit factory SDK increment. Remaining release/recovery mechanisms stay in #28. Older 0.5 session evidence alone does not qualify factory isolation.
- [#32](https://github.com/PerishCode/electron-suite/issues/32) owns shared distribution tooling. --channel selects identity; stable.release.yml/channel.release.yml explicitly select quality gates. Keep version/build/package/check/publish implementations in suite packages, not workflow shell, product scripts or composite actions. Tooling must not silently add stable-specific quality policy.
- [#42](https://github.com/PerishCode/electron-suite/issues/42) owns desktop regression acceptance. The automation package supplies the validation launcher and read-only native Space observer. Fullscreen qualification requires actual native fullscreen, tracked PID activation/exit evidence and a post-exit tail; hidden window facts alone are insufficient.
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

| File or location                                               | Responsibility                                                                       |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| package.json / pnpm-workspace.yaml / pnpm-lock.yaml            | standard dispatch, workspace membership and fixed dependency closure                 |
| pesuite.yaml / biome.json                                      | guard/runtime declarations and formatter/linter configuration                        |
| packages/guard/src/rules/tree.ts / scan/files.ts               | directory allowlists and inspected/pruned boundaries                                 |
| packages/guard/src/config/defaults.ts                          | policy defaults and rule index                                                       |
| packages/cli/src/index.ts / lifecycle.ts / pipeline.ts         | sole public bin and legacy/short distribution entry routing                          |
| packages/pipeline/src                                          | channel identity, immutable build/package receipts, checks and publication           |
| packages/pack/src/platform.ts                                  | matching native platform/architecture layout and safe output separation              |
| packages/sidecar/src/runtime/catalog.ts / control/directory.ts | factory inventory, instance phases and read-only interrupted views                   |
| packages/sidecar/src/runtime/sessions.ts / sessionwire.ts      | lifecycle lanes, private nesting context and controller-owner connection             |
| packages/sidecar/src/state/recovery.ts / inventory.ts          | root-wide exclusive recovery, exact snapshots, dead-owner proof and resumable intent |
| packages/sidecar/src/runtime/ownership.ts                      | persistent exclusive owner records; interrupted/invalid ownership blocks             |
| packages/sidecar/src/control/factory.ts / process/observe.ts   | bound factory API and OS-visible ownership observations                              |
| packages/sidecar/src/control / runtime                         | hosted methods, resource ownership and management transport                          |
| packages/runtime/src/agent.ts / units.ts                       | daemon lease lifecycle and version/API compatibility preflight                       |
| packages/electron/src/renderer.ts                              | actual document epochs and bridge readiness                                          |
| packages/runtime/src/session.ts / capsule.ts                   | generation mounting, execution, activation and recovery                              |
| packages/electron/src/automation.ts                            | background validation policy and window visibility/focus evidence                    |
| packages/electron/src/host.ts / bridge.ts                      | installed host and narrow browser contract                                           |
| packages/release/src/channel.ts / version.ts                   | product-owned channel identity, counted versions and manifest consistency            |
| packages/release / blob / publish / pack                       | content identity, CAS, distribution primitives and unsigned packaging                |
| packages/update/src/index.ts                                   | sidecar-hosted discovery/preparation and optional SDK activation delegation          |
| packages/publish/src/static.ts / client.ts                     | public static feed projection and bounded/cancellable verified retrieval             |
| packages/automation/src                                        | shared background launcher, native desktop observation and verdicts                  |
| packages/sidecar/src/control/connection.ts                     | private manager rendezvous; online identity verification, no inventory authority     |
| packages/inspect/src / packages/serve/src                      | scoped inspection and managed local static sources                                   |
| packages/testkit/src/runner.ts / schema.ts                     | reference qualification API and evidence schema                                      |
| apps/carrier / capsule / web / daemon                          | reference runtime units, not product business code                                   |
| .github/workflows / .githooks/pre-commit                       | CI verification and optional local direct guard hook                                 |

## Iteration workflows

### Local environment

Local checkouts live under ~/Projects/perish.work/electron-suite and ~/Projects/perish.work/open-design-slim. Historical receipts retain their original absolute paths; rerun probes for current paths.
Use Node24 and pnpm11.13.0. Configure GitHub Packages credentials in user .npmrc; repository .npmrc contains routing only.
Run `pnpm install --frozen-lockfile`, then explicitly `pnpm build`. Installation does not build the workspace or configure Git hooks.
If desired, enable the tracked hook after building with `git config core.hooksPath .githooks`.

### Local changes and debugging

Use module-scoped `pnpm --filter @perishcode/<module> build|test|lint` while iterating. Build includes source declarations and test type checking.
Never delete authority/registry files to bypass recovery-required errors. Keep the root and evidence for explicit reconciliation.
Use Service.factory/Client.factory with explicit channel+namespace for product resources and lifecycle; channel comes from the resolved distribution identity. Resources/Bindings/Sidecar are private implementation classes, not public orchestration entry points.
Online inventory uses Service.directory or factory.directory; after interruption use readDirectory(root). These are last committed facts, not PID liveness proof. FactoryEntry.phase describes resource authority. There is no legacy reader or migration adapter.
Group lifecycle writes with Service.session(scope, callback) or Client.session(scope, scopedClient => ...). The manager root plus namespace/channel is the lane; same-scope nesting reenters, cross-scope nesting fails. A scoped Client/Factory expires after its callback. Ordinary business handlers need an already-held controller session before lifecycle writes; business payloads remain caller-owned. Factory grant/revoke/forward/resources/binding entries participate in lifecycle sessions; hosted allocations also require controller sessions from business handlers. These do not provide multi-factory transactions or a resource-use graph.
An unclean controller connection loss blocks its lane as interrupted after accepted operations drain. No timeout steals ownership; shutdown reports recovery required and retains authority. Do not clear records to resume.
Hosted control tests are `pnpm --filter @perishcode/sidecar test`; the real Chromium probe is `PERISH_GUI=1 pnpm --filter @perishcode/carrier test` after building.
Automated Electron runs use HostOptions.automation (probe implies it); retain automation for long-running crash injection. macOS uses accessory policy before ready and non-focusable hidden windows. HostReceipt includes actual show/focus evidence.
inspect/serve increments are tracked by #44 under #11/#12. Use the published CLI/APIs, never root shortcuts.

### Local build and checks

Run `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec biome check .`, and `pnpm exec pesuite guard`.
Use `pnpm exec biome check --write .` for formatting. There is no separate typecheck or format script.

### Local end-to-end qualification

Invoke the actual package API from the repository root:

```sh
node --input-type=module -e 'import { run } from "@perishcode/testkit"; const r=await run({root:process.cwd(),output:".artifacts/qualification.json",packaged:process.env.PERISH_PACKAGE==="1"}); if(r.result==="failed") process.exitCode=1;'
```

Set PERISH_PACKAGE=1 on macOS for unsigned installed qualification. Real Chromium has its separate explicit test above; a caller boolean is not evidence. Reports go under .artifacts. Signing, remote feeds and other platform guarantees require separate acceptance.

### Shared channel distribution

The pipeline package consumes data-only pesuite.yaml/pipeline (four module roots and blob slots) plus the stable base runtime product identity. version/build accept --channel and a full --version or base/count. Build stages fingerprinted carrier/content and overrides the staged host.json, without editing product source configuration. It invalidates the current pointer before compiling; generated outputs cannot escape through symlinks. Runtime product-directory IO belongs to release; runtime re-exports it and does not acquire build-tool dependencies.
Commands: pesuite version/build/check/pack/publish. check gates policy/tests/artifacts/installed/desktop are separate; installed currently runs actual macOS first/cold launch with PID/generation/nonce/drain evidence. pack accepts mac/linux/win on matching native runners/architectures and creates unsigned archives/SHA256. Packaging is not installed-runtime or signing acceptance on every platform.
The two product release workflows contain one short pesuite call per run, with separate quality steps. Quality requirements belong to workflow; publish --require validates only explicitly selected receipts against the current artifact and clean source commit. Publication defaults draft; upload/verification precede any explicit promotion, duplicate tags reject, and failed uploads leave an unpromoted draft. Remote product publication is not required merely to validate tooling.
Use pipeline module tests and independent slim registry CLI execution for acceptance. Stage tarball overrides only under .artifacts; delivered consumer manifests must use exact registry versions. Runtime/electron 0.2 and CLI 0.6 publish the factory-bound SDK in #38. Receipts expose factory scope and sidecar directory facts; old 0.1 receipts are historical only. SIGKILL blocks reopening interrupted roots; binding recover is not manager recovery.

### Reference content, package and npm distribution

After module builds, prepare reference content through the formal capability:

```sh
pnpm exec pesuite release --capsule apps/capsule/dist --daemon apps/daemon/dist --web apps/web/dist --output .artifacts/seed
pnpm exec pesuite pack --carrier apps/carrier/dist --seed .artifacts/seed --output .artifacts/package --receipt .artifacts/package.json
```

These commands do not implicitly compile sources. pack is currently unsigned macOS. The reference carrier is driven by the testkit runtime harness.
For npm delivery, build/check explicitly, run `pnpm --dir packages/<name> pack --pack-destination <absolute-artifact-dir>`, inspect the archive, then publish that archive to GitHub Packages. No prepack hook builds on your behalf.
Record package versions, archive integrity, CI and independent slim registry-consumer results in the owning issue. Keep actual runtime generation separate from npm package versions.

Desktop acceptance is explicit: `pesuite check --channel <name> --gate desktop` on a matching macOS package, while already in a native fullscreen Space. It runs normal exit, incompatible-startup and real SIGKILL cases. Native query/heartbeat/fullscreen precondition failure is unqualified and the gate fails; do not auto-switch the user desktop or mark it passed. The observer uses read-only diagnostic SkyLight SPI and requires Swift command-line tools; it is not a normal product runtime dependency. `--require desktop` binds publication to that artifact's successful evidence.

### Local inspect and static sources

Build first. `pesuite serve --channel stable --namespace primary` reads serve.data/sources from pesuite.yaml and stays in the foreground. Each source uses hosted Context for socket/port and base roots; SIGINT/SIGTERM retires them. Content roots must be separate from manager data. GET/HEAD, single byte Range, ETag and real files are supported; mutable metadata/file selection belongs to callers, not an update state machine. Source generation identifies the service configuration, not the mutable product bytes.
`pesuite inspect list --data <manager-root> --channel <channel> --namespace <namespace>` queries the active manager. probe/call/stop also select service and exact generation; call/stop require the listed incarnation. Arbitrary method/input contracts belong to callers. All CLI output is JSON; operational failure exits 2.
Sidecar owns private control.json publication/removal. It contains local management credentials: never log, copy into receipts or expose it as static content or renderer bootstrap. Online directory identity must match its manager incarnation. It is a rendezvous, not a second resource authority. SIGKILL retains interrupted ownership; stale discovery does not permit reopening or cleanup. No manager adoption is implied.
Session.expose binds caller-owned handlers to the mounted product generation/factory. HostOptions.inspect may register these once all four units are ready; normal startup is unchanged unless the caller opts in. The callback must not await full host shutdown inside its hosted stop handler; schedule quit after the method drains.

### Candidate discovery and preparation

#46 adds publish.writeFeed (public protocol bytes, channel pointer last), bounded/cancellable Feed retrieval and @perishcode/update.watch. The watcher attaches through Session.expose or another caller-owned sidecar Host; Context.roots.resource owns its verified cache and stop aborts/drains network work. inspect service updates/status reports current, phase, revision, prepared target/changed units and errors.
Current and prepared are distinct. watch defaults to preparation. Optional activation delegates exclusively to the owning runtime/Electron adapter; the watcher never directly arms or commits binding. It pins baseline capsule/carrier/blob identities; only web/daemon byte changes are prepared. Cached seed bytes are verified, metadata/proofs are fetched and checked each time, download limits/timeouts are explicit, redirects reject, observed head revision regression/conflict rejects. Head monotonicity is a local observation, not a signed freshness guarantee. Only loopback HTTP is qualified.
Serve's private fault method selects exact path and missing/corrupt/truncate/stall, or null to clear. It does not expose an HTTP mutation endpoint. Use it for deterministic fixtures rather than replacing the resource manager. Minimal-impact activation is tracked by #48 under #13; interrupted commits remain unqualified; public-feed trust and resume are separate.

### Leaf activation and runtime identities

#48 adds unit.json (kind/version/api) inside verified Web/Daemon bytes. release.emitUnit validates canonical channel versions. Changed units must increase their version; candidate Web API requirement must equal candidate Daemon API provision before arm/restart. Legacy seeds may boot without unit manifests but cannot enter leaf activation. Carrier/Capsule/blob bytes must match the current set.
Session owns selection and commit through the same bound factory. Its anchor identifies the host/controller lifetime; generation is the committed compatible set. Daemon process directory generation is its artifact digest, health generation records its launch set, and nonce/PID identify the actual process. Each main-frame document has a separately fenced nonce/generation. Web-only retains the daemon; Daemon-only retains the Web document; coordinated replacement fences the old document before restarting daemon. Receipt units/counts show actual versions, process identity and document navigation count. Bootstrap daemon identity describes initial readiness, not a permanent promise that daemon will never change.
HostOptions.updates.activate opts into shared activation. The product declares feed/key and its own inspect handlers; no product-owned update orchestration. Renderer adapter proves ready through the actual bridge and live daemon, not a caller boolean. Failed activation reports baseline restoration, retains failed binding and refuses more runtime activation; normal quit followed by explicit recover replays the committed generation. Probe/user data is preserved, not transactionally rolled back. Manager interruption still rejects reopening; no adoption or commit-crash safety claim.
Context.background is limited to initialize. Use it only to schedule lifetime-owned background controllers without retaining the initializer's expiring session; never await a new same-lane controller from initialize. After publication the method rejects. Stop must cancel/drain owned timers/work. Business handlers still require controller sessions for lifecycle writes.

### Activation interruption observations

#50 under #13 owns prepared/daemon-stopped/ready/committed diagnostic checkpoints. SessionOptions.onActivation is optional, runs inside the owning activation lane and cannot supply readiness evidence. Do not start another same-lane controller from it. Qualification may pause it for external SIGKILL; product policy must not depend on an observer to select/commit content.
Binding writes sync the temporary file before atomic rename, then sync the containing directory on POSIX. Post-rename synchronization errors poison the live binding owner; it refuses further interpretation/writes. Windows directory sync and power-loss durability are unqualified. readBinding(root, scope) holds manager exclusion while reading exact journal/directory facts, never fails an attempt or adopts an owner. Interrupted authority blocks ordinary and recover startup even if the journal shows a committed candidate. This is safe refusal, not completed recovery. Preserve the entire root and retained contents for explicit reconciliation.
Binding protocol/durability tests are grouped under packages/sidecar/tests/binding (explicit bounded directory pattern). Runtime tests/interruption.test.ts retains actual Node process SIGKILL receipts under .artifacts/interruption; these are distinct from installed Electron evidence. It observes only recorded host/Daemon PIDs, not a full OS helper census. #42 desktop remains independent.

### Stamped process model

#53 replaces the raw child/process-group runner. A private stamped supervisor is the stable OS-visible root; an arbitrary target and its ordinary descendants belong to that instance. Independent stamped roots fence nested resource trees. Factory.start uses service (the same role name as hosted identities), and leases carry exact incarnation. Public launch/Sidecar and legacy inspection exports are removed. serve(endpoint, {root, authority}) has one current signature.
Sidecar owns stamp encoding, private bootstrap IPC, OS process birth observations, stop escalation and retirement. Callers receive lifecycle operations and diagnostic facts. observeProcesses(root, scope) reports OS facts independently of manager memory; it does not adopt or mutate ownership. Directory schema is 4 with owner birth and binding authority markers plus exact supervisor/target witnesses; owner schema is 3 with stamped-supervisor format. Old files are rejected and preserved, not read, migrated or reset.
The standalone supervisor program is embedded at package build time so actual installed consumers do not depend on adjacent files or npm resolution at runtime. src/process and tests/process are explicit bounded responsibilities. Tests cover rewritten target argv, detached helper convergence, controller SIGKILL and independent stamped subtree boundaries. An unexpectedly lost supervisor without terminal evidence remains incomplete, even if the recorded target PID is absent. OS observation is implemented for macOS/Linux; unsupported platforms reject rather than fall back to PID/group checks. No interrupted-owner recovery writes are delivered by this increment.

### Explicit owner recovery

#56 provides inspectRecovery/recover and `pesuite recover inspect|apply --data <manager-root> [--expected <fingerprint>]`. This always reconciles the entire root, all published factories, bound attempts and declared temporary resources. It never takes over live processes. Inspection acquires existing authority locks and briefly reserves old ports; it does not write durable state. Live or unknown owners/instances, unpublished factory or binding authority, replaced endpoint files, metadata conflicts and unsupported formats reject.
Use inspect to obtain a fingerprint, then apply that exact intent. The root SQLite recovery record persists the baseline before resource retirement. Atomic file before/after states and intent-owned pending files make SIGKILL/IO failures retryable; the final directory/manager retirement and complete record commit together. Durable data/CAS remain; a running binding attempt becomes failed without changing current. This does not select product content: subsequent explicit binding recovery may replay the last committed generation. Prepared-but-unpublished authorities and absent committed baselines need separate product handling.
Current format only: owner schema3 records birth and endpoint inode identity, directory schema4 records birth and binding authority before file publication. No old readers or migration. Binding implementation lives in src/state; control/ownership tests are grouped under tests/control, and recovery faults under tests/recovery. Public raw Resources/Bindings exports are removed. Preserve previous experiment roots as history.
OnCheckpoint is diagnostic observation under root-wide exclusion; do not re-enter that root from it. Recovery never logs/copies control.json credentials. Only declared temporary paths and the exact stale manager endpoint/rendezvous are removed. Full unknown-helper census, live adoption, power-loss safety and native fullscreen remain unqualified; ordinary startup never silently initiates recovery.
