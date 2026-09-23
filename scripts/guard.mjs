import { format, guard } from "@perish/guard";

const args = new Set(process.argv.slice(2));
const report = await guard({
  root: process.cwd(),
  staged: args.has("--staged"),
});

process.stdout.write(`${format(report, args.has("--json"))}\n`);
process.exitCode = report.ok ? 0 : 1;
