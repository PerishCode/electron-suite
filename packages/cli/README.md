# @pesuite/cli

The unified pesuite executable. Requires Node.js 24 or newer.

```sh
npm install --save-dev --save-exact @pesuite/cli
npx pesuite guard
npx pesuite guard --root /path/to/repo --json
```

The only executable is `pesuite`; there is no standalone `guard` command.
Configuration is read from `<repo>/pesuite.yaml`, under the `guard` namespace.
Exit codes: 0 clean, 1 policy findings, 2 operational error. Scans the full filesystem; no staged mode.

See the [suite documentation](https://github.com/PerishCode/electron-suite#readme) for policy, coverage, configuration and delivery status.
