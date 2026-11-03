import { createHash } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { canonical, digest, type FactoryScope } from "@perishcode/protocol";
import { type Attachment, type Identity, type Service, serve } from "@perishcode/sidecar";
import { staticServer } from "./static.js";

export { configuration } from "./config.js";

export interface Source {
  directory: string;
}
export interface Endpoint extends Identity {
  incarnation: string;
  url: string;
  directory: string;
}
export interface Methods {
  status: { input: unknown; output: Endpoint };
}
async function canonicalPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return join(await canonicalPath(dirname(path)), basename(path));
  }
}
export class Sources {
  private constructor(
    private manager: Service,
    readonly endpoints: readonly Endpoint[],
  ) {}
  static async open(options: { data: string; scope: FactoryScope; sources: Record<string, Source> }): Promise<Sources> {
    const data = await canonicalPath(resolve(options.data));
    const sources = await Promise.all(
      Object.entries(options.sources).map(async ([name, source]) => {
        if (!/^[a-z][a-z0-9]*$/.test(name)) throw new Error("invalid source name");
        const directory = await realpath(source.directory);
        if (data === directory || data.startsWith(directory + sep) || directory.startsWith(data + sep))
          throw new Error("static content must be separate from manager data");
        if (!(await stat(directory)).isDirectory()) throw new Error("source must be a directory");
        return { name, directory };
      }),
    );
    if (!sources.length) throw new Error("at least one static source is required");
    const key = createHash("sha256").update(data).digest("hex").slice(0, 20);
    const manager = await serve(join(tmpdir(), `pesuite-serve-${key}-${process.pid}.sock`), undefined, undefined, data);
    const endpoints: Endpoint[] = [];
    try {
      const factory = manager.factory(options.scope);
      for (const { name, directory } of sources) {
        let http: Awaited<ReturnType<typeof staticServer>> | undefined;
        let endpoint: Endpoint | undefined;
        const attachment: Attachment = await factory.expose<Methods>({
          identity: { service: name, generation: digest(canonical({ directory, name })) },
          handlers: {
            status: () => {
              if (!endpoint) throw new Error("source not ready");
              return endpoint;
            },
          },
          lifecycle: {
            initialize: async (context) => {
              const socket = await context.allocate({ kind: "socket", name: "static" });
              const port = await context.allocate({ kind: "port", name: "static", scheme: "http" });
              http = await staticServer(directory, socket.value);
              await context.forward(port.value, socket.value);
              endpoint = { ...context.identity, incarnation: context.incarnation, url: port.value, directory };
            },
            stop: async () => {
              await http?.close();
            },
          },
        });
        endpoints.push({ ...attachment.context.identity, ...(endpoint as Endpoint) });
      }
      return new Sources(manager, Object.freeze(endpoints));
    } catch (error) {
      try {
        await manager.close();
      } catch (cleanup) {
        throw new AggregateError([error, cleanup], "source startup and cleanup failed");
      }
      throw error;
    }
  }
  directory() {
    return this.manager.directory();
  }
  close() {
    return this.manager.close();
  }
}
