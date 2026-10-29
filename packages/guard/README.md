# @perishcode/guard

Directory and file engineering policies, consumed through `pesuite guard` from `@perishcode/cli`.
This package exports the checking API and has no executable.

```js
import { guard } from "@perishcode/guard";

const report = await guard({ root: process.cwd() });
console.log(report.ok, report.findings);
```

Reads `<repo>/pesuite.yaml`. Defaults enforce source/test layout, module depth 5, width 8, 500 source lines, style isolation, Vitest/TypeScript/Biome declarations and exact dependency versions.

The scan includes empty directories, does not traverse symlinks, and reports exclusions and links. It does not run tests, compile code, execute repository configuration or prove runtime behavior.

See the [suite documentation](https://github.com/PerishCode/electron-suite#readme) for the complete policy and supported syntax. Registry release status is recorded in [issue #3](https://github.com/PerishCode/electron-suite/issues/3).
