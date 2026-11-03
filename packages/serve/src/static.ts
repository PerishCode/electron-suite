import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, sep } from "node:path";
import { pipeline } from "node:stream/promises";

const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".css": "text/css; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".wasm": "application/wasm",
};
function status(response: ServerResponse, code: number) {
  response.writeHead(code, { "content-length": 0 });
  response.end();
}
async function handle(root: string, request: IncomingMessage, response: ServerResponse) {
  if (request.method !== "GET" && request.method !== "HEAD") return status(response, 405);
  const path = decodeURIComponent((request.url ?? "/").split("?")[0] ?? "/");
  if (!path.startsWith("/") || path.includes("\0") || path.includes("\\") || path.split("/").includes(".."))
    return status(response, 403);
  const target = await realpath(join(root, path.endsWith("/") ? `${path}index.html` : path));
  if (!target.startsWith(root + sep)) return status(response, 403);
  const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile()) return status(response, 404);
    const tag = `W/"${info.size}-${info.mtimeMs}"`;
    const headers = {
      "accept-ranges": "bytes",
      etag: tag,
      "cache-control": "no-cache",
      "content-type": types[extname(target)] ?? "application/octet-stream",
    };
    if (request.headers["if-none-match"] === tag) {
      response.writeHead(304, headers);
      response.end();
      return;
    }
    let start = 0,
      end = info.size - 1,
      code = 200;
    const range = request.headers.range;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2])) {
        response.setHeader("content-range", `bytes */${info.size}`);
        return status(response, 416);
      }
      if (!match[1]) start = Math.max(0, info.size - Number(match[2]));
      else {
        start = Number(match[1]);
        if (match[2]) end = Math.min(end, Number(match[2]));
      }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || end >= info.size) {
        response.setHeader("content-range", `bytes */${info.size}`);
        return status(response, 416);
      }
      code = 206;
      response.setHeader("content-range", `bytes ${start}-${end}/${info.size}`);
    }
    response.writeHead(code, { ...headers, "content-length": Math.max(0, end - start + 1) });
    if (request.method === "HEAD" || info.size === 0) {
      response.end();
      return;
    }
    await pipeline(file.createReadStream({ start, end, autoClose: false }), response);
  } finally {
    await file.close();
  }
}
export async function staticServer(root: string, socket: string) {
  root = await realpath(root);
  const server = createServer((request, response) => {
    void handle(root, request, response).catch((error: NodeJS.ErrnoException) => {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      status(
        response,
        error.code === "ENOENT" || error.code === "ENOTDIR" ? 404 : error instanceof URIError ? 400 : 500,
      );
    });
  });
  await new Promise<void>((done, reject) => {
    server.once("error", reject);
    server.listen(socket, () => {
      server.off("error", reject);
      done();
    });
  });
  return {
    close: () =>
      new Promise<void>((done, reject) => {
        server.close((error) => (error ? reject(error) : done()));
        server.closeAllConnections();
      }),
  };
}
