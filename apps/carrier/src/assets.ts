import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";

const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

export async function asset(root: string, request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.hostname !== "carrier") return new Response("not found", { status: 404 });
  const name = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
  const path = resolve(root, name);
  if (path !== root && !path.startsWith(`${root}/`)) return new Response("forbidden", { status: 403 });
  try {
    return new Response(await readFile(path), {
      headers: { "content-type": types[extname(path)] ?? "application/octet-stream" },
    });
  } catch (fault) {
    if ((fault as NodeJS.ErrnoException).code === "ENOENT") return new Response("not found", { status: 404 });
    throw fault;
  }
}
