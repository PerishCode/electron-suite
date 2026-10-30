import { type ChildProcess, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { DatabaseSync } from "node:sqlite";
import { channel, digest, namespace } from "@perishcode/protocol";
import { expect, it, vi } from "vitest";
import { Client, type Directory, Resources, readDirectory, type Service, type Spec, serve } from "@";

import { Catalog } from "@/runtime/catalog.js";

const scope = { namespace: namespace("main"), channel: channel("stable"), service: "probe", generation: digest("one") };
const spec = (generation = scope.generation): Spec => ({
  namespace: scope.namespace,
  channel: scope.channel,
  slot: scope.service,
  generation,
  command: process.execPath,
  args: ["-e", "process.stdout.write('ready\\n');setInterval(()=>{},1000)"],
  ready: "ready",
  grace: 100,
  timeout: 1000,
});
const options = { identity: scope, handlers: {}, lifecycle: { initialize: async () => {}, stop: async () => {} } };
async function terminate(pid: number): Promise<void> {
  try {
    process.kill(process.platform === "win32" ? pid : -pid, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}
async function fixture(run: (server: Service, root: string, client: Client) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "directory-"));
  const server = await serve(join(root, "m.sock"));
  try {
    await run(server, root, new Client(server.endpoint, server.authority));
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
}
it("publishes initializing before body effects and retains a namespace across manager replacement", async () => {
  await fixture(async (server, root, client) => {
    let publish = () => {};
    const gate = new Promise<void>((done) => {
      publish = done;
    });
    let initialized = () => {};
    const started = new Promise<void>((done) => {
      initialized = done;
    });
    const pending = server.expose({
      ...options,
      lifecycle: {
        initialize: async (context) => {
          const view = server.directory(scope.namespace);
          expect(view.instances[0]).toMatchObject({
            phase: "initializing",
            incarnation: context.incarnation,
            pid: process.pid,
            kind: "hosted",
          });
          initialized();
          await gate;
        },
        stop: async () => {},
      },
    });
    try {
      await Promise.race([started, pending.then(() => undefined)]);
      expect((await client.directory(scope.namespace)).instances[0]?.phase).toBe("initializing");
    } finally {
      publish();
    }
    const attached = await pending;
    const ready = await client.directory(scope.namespace);
    expect(ready.namespaces[0]).toMatchObject({ namespace: scope.namespace, phase: "ready" });
    expect(ready.namespaces[0]?.incarnation).toBeTruthy();
    await expect(new Client(server.endpoint, "forged").directory(scope.namespace)).rejects.toThrow("authority");
    await expect(readDirectory(root)).rejects.toThrow("held");
    await attached.close();
    expect(server.directory().instances[0]?.phase).toBe("retired");
    await server.close();
    const closed = await readDirectory(root);
    expect(closed.manager.phase).toBe("closed");
    expect(closed.namespaces[0]?.phase).toBe("closed");
    const next = await serve(join(root, "next.sock"));
    try {
      const retained = next.directory();
      expect(retained.manager.incarnation).not.toBe(closed.manager.incarnation);
      expect(retained.namespaces).toEqual(closed.namespaces);
      expect(retained.instances).toEqual(closed.instances);
      const replacement = await next.expose({ ...options, identity: { ...scope, generation: digest("two") } });
      expect(replacement.context.incarnation).not.toBe(attached.context.incarnation);
      expect(replacement.context.roots.data).toBe(attached.context.roots.data);
      await attached.close();
      expect(next.directory().instances[0]?.phase).toBe("ready");
    } finally {
      await next.close();
    }
  });
});
it("records one actual process instance across attachments and excludes other generations or hosted bodies", async () => {
  await fixture(async (server, _root, client) => {
    const first = await client.start({ ...spec(), env: { PESUITE_PRIVATE_PROBE: "secret-value" } });
    const second = await client.start({ ...spec(), env: { PESUITE_PRIVATE_PROBE: "secret-value" } });
    const ready = await client.directory(scope.namespace);
    expect(ready.instances).toHaveLength(1);
    expect(ready.instances[0]).toMatchObject({ ...scope, kind: "process", phase: "ready", pid: first.pid });
    expect(ready.namespaces[0]).toMatchObject({ namespace: scope.namespace, phase: "unopened" });
    expect(JSON.stringify(ready)).not.toMatch(/secret-value|capability|token|scope|args|env/);
    expect(JSON.stringify(ready)).not.toContain(first.capability);
    await expect(client.start(spec(digest("two")))).rejects.toThrow("already owned");
    await expect(server.expose(options)).rejects.toThrow("already owned");
    expect(await client.release(first)).toMatchObject({ status: "retained" });
    expect(server.directory().instances[0]?.phase).toBe("ready");
    expect(await client.release(second)).toMatchObject({ status: "stopped" });
    expect(server.directory().instances[0]?.phase).toBe("retired");
    await server.expose(options);
    expect(server.directory().instances[0]?.kind).toBe("hosted");
  });
});
it.runIf(process.platform !== "win32")(
  "keeps the last process lease through a real stop failure and permits exact retry",
  async () => {
    await fixture(async (server, _root, client) => {
      const lease = await client.start(spec());
      const kill = process.kill.bind(process);
      const spy = vi.spyOn(process, "kill").mockImplementation(((pid: number, signal?: NodeJS.Signals | number) => {
        if (pid === -lease.pid && signal === "SIGTERM")
          throw Object.assign(new Error("injected signal denial"), { code: "EPERM" });
        return kill(pid, signal);
      }) as typeof process.kill);
      try {
        await expect(client.release(lease)).rejects.toThrow("signal denial");
        expect(kill(lease.pid, 0)).toBe(true);
        expect(server.directory().instances[0]?.phase).toBe("failed");
        expect((await client.inspect())[0]?.attachments).toBe(1);
        await expect(client.attach(lease)).rejects.toThrow("not accepting");
        await expect(client.start(spec(digest("next")))).rejects.toThrow("already owned");
      } finally {
        spy.mockRestore();
      }
      expect(await client.release(lease)).toMatchObject({ status: "stopped" });
      expect(await client.release(lease)).toMatchObject({ status: "stopped" });
      expect(server.directory().instances[0]?.phase).toBe("retired");
      expect(() => kill(lease.pid, 0)).toThrow();
    });
  },
);
it("records observed startup cleanup and keeps namespace filters isolated", async () => {
  await fixture(async (server, _root, client) => {
    await expect(client.start({ ...spec(), ready: "never", timeout: 100 })).rejects.toThrow("readiness timeout");
    expect(server.directory().instances[0]).toMatchObject({ kind: "process", phase: "retired" });
    await server.expose(options);
    await server.expose({ ...options, identity: { ...scope, namespace: namespace("other") } });
    const view = await client.directory(scope.namespace);
    expect(view.instances).toHaveLength(1);
    expect(view.namespaces).toHaveLength(1);
    expect(server.directory().instances).toHaveLength(2);
  });
});
it("retains failed hosted ownership in the persistent directory until drain retries", async () => {
  await fixture(async (server, _root, client) => {
    let fail = true;
    const attached = await server.expose({
      ...options,
      lifecycle: {
        initialize: async () => {},
        stop: async () => {
          if (fail) throw new Error("drain failed");
        },
      },
    });
    await expect(attached.close()).rejects.toThrow("drain failed");
    expect((await client.directory(scope.namespace)).instances[0]?.phase).toBe("failed");
    fail = false;
    await attached.close();
    expect(server.directory().instances[0]?.phase).toBe("retired");
  });
});
it("does not turn missing or malformed committed metadata into an empty directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "directory-bad-"));
  try {
    const server = await serve(join(root, "m.sock"));
    await server.close();
    const file = join(root, "manager.sqlite");
    const db = new DatabaseSync(file);
    db.exec("DELETE FROM directory");
    db.close();
    const before = await readFile(file);
    await expect(readDirectory(root)).rejects.toThrow("unpublished");
    expect(await readFile(file)).toEqual(before);
    await expect(serve(join(root, "next.sock"))).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("reads last committed hosted and process identities after SIGKILL without rewriting authority or registry", async () => {
  const root = await mkdtemp(join(tmpdir(), "directory-crash-"));
  const module = new URL("../dist/index.mjs", import.meta.url).href;
  const body = `import {serve,Client} from ${JSON.stringify(module)};
    const root=process.argv[1];const service=await serve(root+'/m.sock');
    await service.expose({identity:JSON.parse(process.argv[2]),handlers:{},lifecycle:{initialize:async(context)=>{
      await context.allocate({kind:'lock',name:'probe'});
    },stop:async()=>{}}});
    const lease=await new Client(service.endpoint,service.authority).start(JSON.parse(process.argv[3]));
    console.log(JSON.stringify({view:service.directory(),pid:lease.pid}));process.stdin.resume();
    process.once("SIGTERM",async()=>{await service.close();process.stdin.destroy();});`;
  let child: ChildProcess | undefined;
  let descendant: number | undefined;
  try {
    child = spawn(
      process.execPath,
      ["--input-type=module", "-e", body, root, JSON.stringify(scope), JSON.stringify({ ...spec(), slot: "daemon" })],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    const lines = createInterface({ input: child.stdout as NonNullable<ChildProcess["stdout"]> });
    const ready = await new Promise<{ view: Directory; pid: number }>((done, reject) => {
      const timer = setTimeout(() => reject(new Error("directory child timeout")), 5000);
      child?.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child?.once("exit", () => {
        clearTimeout(timer);
        reject(new Error("directory child exited"));
      });
      lines.once("line", (line) => {
        clearTimeout(timer);
        lines.close();
        done(JSON.parse(line));
      });
    });
    descendant = ready.pid;
    const file = join(root, "manager.sqlite");
    const registry = join(root, "namespaces/main/registry.json");
    const before = await readFile(file);
    const resourceBefore = await readFile(registry);
    const ended = new Promise<void>((done) => child?.once("exit", () => done()));
    child.kill("SIGKILL");
    await ended;
    expect(process.kill(descendant, 0)).toBe(true);
    const view = await readDirectory(root, scope.namespace);
    expect(view.manager.phase).toBe("interrupted");
    expect(view.instances).toEqual(ready.view.instances);
    expect(view.instances.map((entry) => entry.kind).sort()).toEqual(["hosted", "process"]);
    expect(await readFile(file)).toEqual(before);
    expect(await readFile(registry)).toEqual(resourceBefore);
    await expect(serve(join(root, "next.sock"))).rejects.toThrow("recovery required");
    expect((await stat(registry)).isFile()).toBe(true);
  } finally {
    if (child?.exitCode === null && child.signalCode === null) {
      const ended = new Promise<void>((done) => child?.once("exit", () => done()));
      child.kill("SIGTERM");
      await ended;
    }
    if (descendant) {
      await terminate(descendant);
    }
    await rm(root, { recursive: true, force: true });
  }
});

it("retains an acquired namespace handle when ready publication fails", async () => {
  await fixture(async (server, root) => {
    const original = Catalog.prototype.namespace;
    let fail = true;
    const spy = vi.spyOn(Catalog.prototype, "namespace").mockImplementation(function (this: Catalog, ...args) {
      if (args[1] === "ready" && fail) {
        fail = false;
        throw new Error("injected directory publication failure");
      }
      return original.apply(this, args);
    });
    try {
      await expect(server.expose(options)).rejects.toThrow("directory publication failure");
    } finally {
      spy.mockRestore();
    }
    await server.close();
    expect((await readDirectory(root)).namespaces[0]?.phase).toBe("closed");
    const resources = await Resources.open({ root, namespace: scope.namespace });
    await resources.close();
  });
});
