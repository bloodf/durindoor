import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
};

/**
 * Serves `directory` over HTTP on an ephemeral port. Returns `{ url, close }`.
 * Used by the Storybook browser tests so they never depend on a running dev server.
 */
export async function serveDirectory(directory) {
  const root = resolve(directory);
  const server = createServer((request, response) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname); }
    catch { response.writeHead(400).end(); return; }
    // Browsers probe /favicon.ico on the first top-level load; Storybook ships none.
    if (pathname === "/favicon.ico" && !existsSync(join(root, "favicon.ico"))) { response.writeHead(204).end(); return; }
    let file = normalize(join(root, pathname));
    if (file !== root && !file.startsWith(root + sep)) { response.writeHead(403).end(); return; }
    try { if (statSync(file).isDirectory()) file = join(file, "index.html"); statSync(file); }
    catch { response.writeHead(404).end(); return; }
    response.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
    createReadStream(file).on("error", () => response.destroy()).pipe(response);
  });
  await new Promise((done, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", done); });
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((done) => { server.close(() => done()); server.closeAllConnections?.(); }),
  };
}
