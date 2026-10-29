# @perishcode/cli

The unified pesuite executable. Requires Node.js 24 or newer.

```sh
npm config set @perishcode:registry https://npm.pkg.github.com
npm install --save-dev --save-exact @perishcode/cli
npx pesuite guard
npx pesuite guard --root /path/to/repo --json
```

The only executable is `pesuite`; there is no standalone `guard` command.
Configuration is read from `<repo>/pesuite.yaml`, under the `guard` namespace.
Exit codes: 0 clean, 1 policy findings, 2 operational error. Scans the full filesystem; no staged mode.

See the [suite documentation](https://github.com/PerishCode/electron-suite#readme) for policy, coverage, configuration and delivery status.

GitHub Packages authentication belongs in the user npm configuration, never repository source. The repository only declares non-secret scope routing.
