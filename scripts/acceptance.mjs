import { run } from "@perish/testkit";

const report = await run({
  chromium: process.env.PERISH_CHROMIUM === "passed",
  output: process.env.PERISH_REPORT ?? ".artifacts/qualification.json",
  packaged: process.env.PERISH_PACKAGE === "1",
  root: process.cwd(),
});

process.stdout.write(`${JSON.stringify({
  report: process.env.PERISH_REPORT ?? ".artifacts/qualification.json",
  result: report.result,
  scenarios: report.scenarios.length,
})}\n`);

if (report.result === "failed") process.exitCode = 1;
