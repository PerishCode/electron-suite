import { spawn } from "node:child_process";

const args = [
  "-r",
  "--if-present",
  "--workspace-concurrency=4",
  "run",
  "build",
];

const code = await new Promise((resolve, reject) => {
  const child = spawn("pnpm", args, { stdio: "inherit" });

  child.once("error", reject);
  child.once("exit", (status, signal) => {
    if (signal) {
      reject(new Error(`workspace build stopped by ${signal}`));
      return;
    }

    resolve(status ?? 1);
  });
});

process.exitCode = code;
