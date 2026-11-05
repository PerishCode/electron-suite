# electron-suite

## Meta rules

- [#1](https://github.com/PerishCode/electron-suite/issues/1) owns the long-term direction and stays Open until the full product lifecycle is proven. Use Refs #1 for incremental work; mechanism issues and [#7 evidence](https://github.com/PerishCode/electron-suite/issues/7) retain detailed history.
- suite owns reusable engineering mechanisms and distributes fixed @perishcode packages through GitHub Packages. open-design-slim owns product composition and consumes published versions. Current delivery is carrier/application skeletons and probes; do not migrate OpenDesign business features without authorization.
- Grow the architecture in an orderly way within the existing responsibility framework. Unclear or overlapping boundaries are expected: locate existing owners, explain candidate placements, dependency direction and lifecycle consequences, then discuss and resolve the concrete design. Authorized evolution may move responsibilities, split a package or add a capability. Once agreed, update implementation, contracts, validation and the responsibility/file indexes together. Do not indefinitely block progress on ambiguity or evade the discussion by copying mechanisms, adding hidden bypasses or growing responsibilities without control.
- Proceed autonomously with routine work inside established responsibilities and authorized directory patterns. Use the authorization already given in the session; request a decision only when unresolved alternatives materially change responsibility ownership, dependency direction or lifecycle closure. The responsibility inventory below is the current working agreement, not an immutable final architecture.
- sidecar is the authority for channel+namespace system resources and process lifecycle; release owns product distribution identity. Capsule has no independent sidecar identity. Preserve failed/unknown ownership and use explicit recovery; resource authority must not escape through carriers, fixtures or helper code.
- Public capabilities use pesuite subcommands or owning package APIs. package.json scripts contain only lint/test/build; root scripts only dispatch `pnpm -r --if-present run <same-name>`. pnpm has no --if-exists option. Do not add aggregation shortcuts, lifecycle hooks, root callbacks or scripts directories.
- Keep implementation in owning packages, quality requirements in workflows and actual evidence in receipts/issues. Do not add compatibility readers, fallback formats, aliases or migrations for discarded experimental layouts. Missing evidence remains unqualified.

### Change placement

| Responsibility of the change                                       | Initial placement       |
| ------------------------------------------------------------------ | ----------------------- |
| Environment-specific startup, adaptation, composition and delivery | carriers                |
| Product pages, interactions and service behavior                   | apps/web or apps/daemon |
| Reusable contracts, mechanisms and engineering capabilities        | packages                |

A request may span all three layers. Find the existing owner of each part before adding an abstraction; code shared by several files does not by itself justify a package. Keep environment wiring in carrier adapters, product behavior in apps and reusable mechanisms in suite packages. Shared apps consume explicit contracts rather than concrete carrier internals; packages must not depend on a concrete app/carrier to orchestrate that product.
For example: a product feature changes Web/Daemon and adds carrier wiring only where required; a new carrier composes existing apps/packages; update/resource/process changes start in their owning packages; environment information uses the carrier package contract with collection and transport wired by concrete carriers. In slim, packages may hold justified product-owned shared modules; shared engineering mechanisms belong upstream in suite.

## Directory conventions

- guard and pesuite.yaml are the engineering-policy authority; this is a navigation summary. Every directory node, including hidden, empty and test directories, must match a repository-relative or module-relative allowlist. Parent approval does not authorize descendants.
- Authorized bounded patterns permit routine expansion. For a new responsibility or pattern, establish scope using the existing session authorization or a necessary design discussion, declare bounded patterns and update relevant coverage/indexes. Do not widen patterns, excludes or exceptions just to silence findings. Generated/dependency/runtime exclusions do not authorize unmanaged source or static-resource trees.
- carriers contains delivery hosts; apps contains shared Web/Daemon units; packages contains shared capabilities. Source belongs in src and tests in sibling tests/**/*.test.ts. Electron Capsule belongs in carriers/electron/src/capsule and remains an independently built dist/capsule artifact.
- Source files <=500 lines; module depth <=5 and width <=8, with only the configured components width exemption. Style definitions are confined to packages/components/**/*.less; other source files must not define styles.
- Modules own independent source/test tsconfigs, @ -> ./src in test config, and applicable build/Vitest configs. Use TS7, Vitest, Biome, exact x.y.z external dependencies and workspace:* for local modules. Empty scaffolds have no build stub and do not claim functional tests.
- Root AGENTS.md and README.md are the prose entry points. Historical evidence retains its original paths and versions; it is not a source-layout instruction.

## Responsibility and core file index

### Suite responsibilities

Names below refer to electron-suite packages and their @perishcode contracts. They identify the current owner to consult, not a rule that future responsibilities can never change.

| Package      | Owned responsibility and adjacent boundary                                                                                                                                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| protocol     | Data contracts, identities, digests, validation and pure state transitions; runtime authority belongs to sidecar.                                                                                                                                      |
| config       | Product name/scheme/version provider definitions consumed by release; not a general configuration registry or carrier environment store.                                                                                                               |
| carrier      | Intended environment-fact definition, registration and propagation. Private empty scaffold: no public API or implementation. Concrete carriers will collect facts and wire transport; product identity stays in release and resources stay in sidecar. |
| sidecar      | channel+namespace factory authority, process identity, ports, granted paths, lifecycle sessions and explicit dead-owner recovery; arbitrary business messages belong to callers.                                                                       |
| inspect      | Discovery, observation, calls and stop through the sidecar management contract; no separate inventory authority or fixed business/debug protocol.                                                                                                      |
| serve        | Sidecar-managed local static-service orchestration; update policy belongs to consumers.                                                                                                                                                                |
| blob         | Verified retrieval, typed materialization, CAS/cache, references, actual Uses, retention and GC; uses sidecar ownership and does not own user data.                                                                                                    |
| release      | Product/channel/version identity, unit manifests, content archives and product-content composition/IO; not installation or workflow quality policy.                                                                                                    |
| publish      | Signed content-generation publication authority, feed projection and verified feed retrieval; product shell negotiation belongs to distribution.                                                                                                       |
| distribution | Product metadata, minimum-shell compatibility, platform shell selection and S3 publication/retrieval; not physical installation or runtime commit authority.                                                                                           |
| update       | Runtime candidate discovery, verification and preparation; activation is delegated to the actual lifecycle owner.                                                                                                                                      |
| runtime      | Content generations, binding selection/commit, Capsule/Web/Daemon composition, activation, recovery and actor Uses. Current implementation is still shaped around the Electron suite; carrier-neutral extraction remains a design discussion.          |
| electron     | Electron host adaptation: windows, preload/IPC, protocols, document lifecycle, native compatibility blocking and installer handoff; product wiring stays in the concrete carrier.                                                                      |
| installer    | Independent installation authority, old-host drain, physical replacement, new-host confirmation and interruption recovery; currently macOS, not a generic all-platform installer.                                                                      |
| pack         | Platform delivery-artifact assembly; currently Electron packaging. Multi-carrier adapters are not implemented.                                                                                                                                         |
| pipeline     | Version/build/package/check/publication orchestration and immutable receipts for thin workflows; workflows choose quality requirements.                                                                                                                |
| cli          | pesuite argument parsing, command routing and output; mechanisms stay in owning packages.                                                                                                                                                              |
| guard        | Directory/file policy configuration, scanning and compliance findings.                                                                                                                                                                                 |
| automation   | Automated Electron launch, read-only native desktop observation and verdicts; validation infrastructure, not product runtime policy.                                                                                                                   |
| testkit      | Private reference-skeleton scenarios, qualification matrix and evidence/report association; not a product runtime dependency.                                                                                                                          |

The config/carrier/release, release/publish/distribution/pipeline, runtime/electron/Capsule and pack/carrier interfaces are recurring design discussion points. Use the meta rule to resolve concrete changes; do not treat either an unresolved boundary as a permanent blocker or a target architecture as already implemented.

### Carrier and application responsibilities

| Unit                          | Current responsibility/status                                                                                                                                                                  |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| carriers/electron             | Concrete Electron entry and composition of suite capabilities.                                                                                                                                 |
| carriers/electron/src/capsule | Loading composition, IPC adaptation, local protocols and Web/Daemon update lifecycle. Separately compiled loaded code, with no sidecar process/service/incarnation/resource domain of its own. |
| carriers/standalone           | Empty source/test scaffold; runtime closure remains under discussion.                                                                                                                          |
| carriers/docker               | Empty source/test scaffold; runtime and packaging remain unimplemented.                                                                                                                        |
| carriers/codexplugin          | Empty source/test scaffold; host integration remains unimplemented.                                                                                                                            |
| apps/web                      | Shared browser-side product behavior; currently a skeleton probe.                                                                                                                              |
| apps/daemon                   | Shared service-side product behavior; currently a skeleton probe.                                                                                                                              |

All carriers are intended to share one product version/channel and one coordinated release. Existing workflows implement Electron delivery only. Carrier selection, aggregate release receipts, pack/release adapters and compatibility naming remain pending discussion. The numeric runtime.carrier compatibility field is not the new carrier-kind dimension. Do not implement pending carriers or their release behavior as a side effect of unrelated work. packages/carrier also remains an empty scaffold until its contract is agreed.

### Local file index

| File/location                                                           | Entry responsibility                                                                  |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| package.json / pnpm-workspace.yaml / pnpm-lock.yaml                     | Workspace membership, standard dispatch and exact dependency closure.                 |
| pesuite.yaml / biome.json / .npmrc                                      | Policy/runtime settings, bounded directory patterns, formatting and registry routing. |
| packages/*/src/index.ts                                                 | Public package entry; carrier currently has no implementation/public entry.           |
| packages/sidecar/src/control / runtime / state / process                | Factory/session APIs, inventory/ownership, durable recovery and stamped processes.    |
| packages/runtime/src/control / generations.ts / lifecycle.ts            | Content bootstrap, activation, document/Daemon Uses and Capsule contract.             |
| packages/electron/src/host.ts / bridge.ts / control                     | Native host, trusted bridge, renderer and compatibility gate.                         |
| packages/blob/src/library.ts / control / types.ts                       | Resource ledger, scoped access, deletion and occupation contracts.                    |
| packages/installer/src                                                  | Independent installation domain, transaction, executor and worker.                    |
| packages/release/src / packages/publish/src / packages/distribution/src | Product/content generation, signed feed and signed product distribution.              |
| packages/pipeline/src / packages/pack/src / packages/cli/src            | Shared workflow orchestration, current native packaging and pesuite routing.          |
| packages/guard/src/config / rules / scan                                | Policy authority and filesystem inspection.                                           |
| packages/automation/src / packages/testkit/src                          | Native validation observations and reference qualification.                           |
| carriers/electron/src / tests                                           | Stable reference host; src/capsule and tests/capsule own separately built Capsule.    |
| apps/web/src / apps/daemon/src                                          | Shared reference application probes.                                                  |
| .github/workflows/ci.yml / .githooks/pre-commit                         | Source CI and optional direct guard hook.                                             |

## Iteration workflows

### Placement and change loop

Classify the request, locate package/unit owners and inspect their current contracts. Routine changes proceed within the agreed scope; for material ownership/dependency/lifecycle changes, present a concrete solution and tradeoffs, reuse existing authorization and settle only the unresolved decision. Implement the agreed slice, validate its actual behavior and update this inventory/index when responsibilities or entry points change. Keep outcomes and evidence in the owning issue rather than appending a chronological architecture diary here.
Documentation-only changes require documentation/config/guard checks, not new runtime tests. For code changes, run relevant module builds/tests plus root lint, direct root Biome and guard; full workspace build/tests are standard integration checks. Use existing tests and real lifecycle evidence where needed, not tests that merely mirror implementation or empty-scaffold results presented as capability acceptance.

### Local environment

Checkouts live under ~/Projects/perish.work/electron-suite and ~/Projects/perish.work/open-design-slim. Use Node24 and the pinned pnpm11.13.0. Credentials belong in user ~/.npmrc; repository .npmrc contains registry routing only. Run pnpm install --frozen-lockfile, then build explicitly. Installation must not create aggregation/hooks or build implicitly.

### Build and engineering checks

Modules own their lint/test/build tools. At root, use pnpm build, pnpm test, pnpm lint, pnpm exec biome check . and pnpm exec pesuite guard. Format with pnpm exec biome check --write .; there are no typecheck/format/guard aliases. Run only scripts actually present for an empty scaffold. An explicit --root is required when guard must inspect an isolated staging copy inside another Git worktree.

### Runtime debugging and lifecycle changes

Use bound Service.factory/Client.factory with the resolved channel and explicit namespace, and hosted Context grants for system resources. A factory is channel+namespace; installation authority is shared across a product/channel's runtime namespaces. Persistent data/logs/cache/CAS and exact-incarnation runtime/socket/lock/staging paths retain their owning lifecycle. User data stays outside content-version and application-bundle directories.
Factory directory facts are last committed state, not proof of OS liveness; observeProcesses supplies independent OS facts. Sidecar hides stamp encoding, supervisor/bootstrap IPC, discovery credentials, stop escalation and retirement. Never assemble a product manager from raw process scans, private ports or guessed paths. control.json is private rendezvous material, not another inventory authority; never publish/copy it or pass credentials to Web.
Group lifecycle writes with Service.session/Client.session or factory.session. Scoped handles expire after the callback; same-factory nesting reenters, cross-factory nesting rejects. Business handlers need a held controller session before lifecycle writes. Context.background is an initialization-only scheduling capability; do not await a new same-lane controller from initialize. lifecycle.quiesce cancels/drains background controllers before the stop lane; callers already holding that lane must predrain dependent work.
Keep one content commit owner. Capsule coordinates leaf updates through suite mechanisms; stable Electron bootstrap owns Capsule replacement; installer owns shell replacement across old-host exit. Preparation and current content are distinct. Activation commits only after actual document/Daemon readiness and compatibility checks; a persisted commit is not rolled back because a subsequent observer failed. Document epochs and actual process incarnations fence old calls.
Retain prepared/current/recovery references and actual actor Uses until reads, streams, documents or processes drain. Capsule resources belong to the actual Electron subject. Web Uses cover real document epochs; Daemon Uses cover its actual lease, including launch handoff. Failed or unknown consumers remain protective. Library.session composes inside a held factory lane; do not call background-dispatched Library methods from that lane. Buffered read and durable referencedPath protection do not replace actor Uses.
Interrupted ownership requires explicit root-wide inspectRecovery/recover or `pesuite recover inspect/apply --data <root> --expected <fingerprint>`. Never delete authority/registry/ledger files, infer death from elapsed time, reset an established Library ledger, silently recover on startup or adopt a live process. Binding replay is separate from manager recovery. Diagnostic activation/content/installer checkpoints do not determine readiness or GC policy and must not reenter the held lane/root.
Runtime CAS/views can be collected after references/Uses retire; partial directory deletion resumes from durable deleting intent after the required recovery. Envelope history and installation job/record/policy/archive/content/backup/executor/worker materials are long-term retained in this phase, including after confirmation/shutdown. No automatic history purge exists. Preserve failed roots and unknown material; measure disk costs before proposing maintenance policy.

### Shared build and release flow

pesuite.yaml owns stable base product settings and pipeline module/output locations; explicit per-unit dist outputs let one Electron module build host and Capsule separately. Never inline Capsule into the stable main bundle. Current tooling exposes pesuite version/build/check/pack/publish with --channel and canonical version selection; do not invent a --carrier implementation before its model is agreed.
Build stages fingerprinted content and records source/identity; pack consumes the build receipt on a matching native platform/architecture. Modified content and stale/mismatched quality receipts reject publication. stable.release.yml selects additional policy/tests/installed gates; channel.release.yml currently selects build/pack/artifacts on native runners. Each action stays a short package call; no workflow shell/composite actions/product scripts implementing mechanisms. The tool does not silently add stable-specific quality policy.
Publication checks explicitly selected receipts, creates an unpromoted draft, uploads/verifies assets and only then promotes when requested; existing tags are not overwritten. Workflows default publish=false. Package creation, installed runtime, signing and public distribution are separate qualification levels.
Product S3 metadata/content/shell publication belongs to distribution, with verified immutable objects before conditional channel-head advancement. Readers use public GET and a pinned metadata key; writer credentials/SDK must not enter the renderer. Minimum-shell checks precede Capsule/product initialization and online blocking drains work through the owning adapters. A known signed floor and local monotonic observations do not prove global freshness.

### Evidence and current scope

Record commands, expected/actual results, source and consumer commits/trees, package versions/integrities, real process identities, generations, paths and immutable receipt hashes. Distinguish current runs, inherited evidence and unqualified cells; never relabel historical receipts as new-version full regression. Ordinary tests skip opt-in native cases and do not qualify installed behavior. Empty source/test scaffolds provide no runtime evidence.
Automated Electron runs use suite automation: accessory policy before macOS ready, hidden non-focusable windows, no automatic focus/desktop switching. Fullscreen qualification requires an actual native fullscreen starting Space, tracked activation/exit events and a post-exit tail; missing preconditions/sampling remain unqualified. Do not create fullscreen or switch the user's desktop to satisfy the gate.
Local acceptance is unsigned macOS plus declared Compose Silo where selected. Packaging Windows/Linux does not qualify installed runtime there. Global default URL resolution/channel-app coexistence, full native fullscreen, signing/notarization, public IAM/CDN/TLS, global freshness and power-loss guarantees require their own evidence. Registered actor/OS observations do not imply a complete unregistered-helper census.
[#75](https://github.com/PerishCode/electron-suite/issues/75) local closeout and [#78](https://github.com/PerishCode/electron-suite/issues/78) carrier layout are completed history. The [#77 continuous journey](https://github.com/PerishCode/electron-suite/issues/77) is deferred while the user discusses carrier boundaries. This AGENTS change does not resume it or authorize new carrier/runtime implementation.

### Source development and reference launch

Use `pnpm --filter @perishcode/<package> build|test|lint` where the script exists. The private reference Electron module is @perishcode/reference-electron; the carrier environment scaffold is @perishcode/carrier. They are different responsibilities. Optional local hook setup is `git config core.hooksPath .githooks` after building; installation must not set it.
Prepare reference content and package through the formal APIs after building:

```sh
pnpm exec pesuite release --capsule carriers/electron/dist/capsule --daemon apps/daemon/dist --web apps/web/dist --output .artifacts/seed
pnpm exec pesuite pack --carrier carriers/electron/dist --seed .artifacts/seed --output .artifacts/package --receipt .artifacts/package.json
```

These commands do not compile inputs. Read carriers/electron/src/runtime.ts for the reference harness environment; do not assume it has slim's bootstrap contract.

### Source end-to-end and npm delivery

Invoke the existing reference qualification API after builds:

```sh
node --input-type=module -e 'import { run } from "@perishcode/testkit"; const r=await run({root:process.cwd(),output:".artifacts/qualification.json",packaged:process.env.PERISH_PACKAGE==="1"}); if(r.result==="failed") process.exitCode=1;'
```

PERISH_PACKAGE=1 requests unsigned installed macOS qualification; `PERISH_GUI=1 pnpm --filter @perishcode/reference-electron test` selects the separate actual Chromium probe. sidecar/runtime/blob/installer module tests exercise their own contracts; they do not substitute for the downstream installed journey.
For Silo tests, start `docker compose -p <isolated-name> up -d`, obtain the API with `docker compose -p <same-name> port silo 9000` and set PESUITE_SILO_ENDPOINT for packages/distribution tests. Use loopback only and the pinned Compose image. Stop the same project without deleting volumes; retain buckets/failure evidence and never use down -v.
After relevant builds/checks, `pnpm --dir packages/<name> pack --pack-destination <absolute-artifact-dir>`, inspect the archive/dependency closure, then publish that archive to GitHub Packages when authorized. There is no prepack hook. Private scaffolds are not npm deliverables. Stage tarball overrides only under .artifacts; qualify actual downstream fixed-registry consumption before claiming delivery. Record source/consumer identities, archive integrity, CI and native results in the owning issue.
