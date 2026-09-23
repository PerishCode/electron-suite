import { spawn, type ChildProcess } from "node:child_process";

export interface Launch {
  args?: string[];
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  grace?: number;
  ready: string;
  timeout?: number;
}

export interface Stop {
  status: "stopped" | "partial";
  survivors: number[];
}

export interface Running {
  active(): boolean;
  pid: number;
  stop(): Promise<Stop>;
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function active(pid: number): boolean {
  try {
    process.kill(process.platform === "win32" ? pid : -pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function signal(child: ChildProcess, value: NodeJS.Signals): void {
  if (!child.pid) return;

  try {
    if (process.platform === "win32") child.kill(value);
    else process.kill(-child.pid, value);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

async function ended(pid: number, timeout: number): Promise<boolean> {
  const limit = Date.now() + timeout;

  while (Date.now() < limit) {
    if (!active(pid)) return true;
    await pause(20);
  }

  return !active(pid);
}

async function retire(child: ChildProcess, grace: number): Promise<Stop> {
  const pid = child.pid;

  if (!pid || !active(pid)) return { status: "stopped", survivors: [] };
  signal(child, "SIGTERM");
  if (await ended(pid, grace)) return { status: "stopped", survivors: [] };
  signal(child, "SIGKILL");
  const stopped = await ended(pid, 500);

  return {
    status: stopped ? "stopped" : "partial",
    survivors: stopped ? [] : [pid],
  };
}

function wait(child: ChildProcess, marker: string, timeout: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("readiness timeout")), timeout);
    const done = (operation: () => void) => {
      clearTimeout(timer);
      operation();
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.includes(marker)) done(resolve);
    });
    child.once("error", (error) => done(() => reject(error)));
    child.once("exit", (code) => done(() => reject(new Error(`process exited before readiness: ${code}`))));
  });
}

export async function launch(spec: Launch): Promise<Running> {
  const env = { ...process.env, ...spec.env };
  delete env.PERISH_SIDECAR_AUTHORITY;
  delete env.PERISH_SIDECAR_ENDPOINT;
  const child = spawn(spec.command, spec.args ?? [], {
    cwd: spec.cwd,
    detached: process.platform !== "win32",
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const grace = spec.grace ?? 1000;

  try {
    await wait(child, spec.ready, spec.timeout ?? 5000);
  } catch (error) {
    await retire(child, grace);
    throw error;
  }

  const pid = child.pid;
  if (!pid) throw new Error("process has no pid");

  return {
    active: () => active(pid),
    pid,
    stop: () => retire(child, grace),
  };
}
