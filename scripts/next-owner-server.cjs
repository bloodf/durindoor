#!/usr/bin/env node

const http = require("http");
const path = require("path");
const {
  canonicalizeRuntimePaths,
  createOwnerAwareHandler,
  setProcessTitle,
} = require("../custom-server");

const dev = process.argv.includes("--dev");
if (dev) process.env.NODE_ENV = "development";
canonicalizeRuntimePaths();
const next = require("next");
const portFlag = process.argv.indexOf("--port");
const port = Number(process.env.PORT || (portFlag >= 0 ? process.argv[portFlag + 1] : dev ? 20127 : 20128));
// Security: bind to loopback by default; the dashboard runs privileged system
// commands and must not be reachable from the public internet. Set HOSTNAME=0.0.0.0
// to expose it deliberately behind your own auth/proxy (#2725).
const hostname = process.env.HOSTNAME || "127.0.0.1";
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("Invalid server port");

process.env.PORT = String(port);
setProcessTitle();

const app = next({ dev, webpack: true, dir: path.resolve(__dirname, ".."), hostname, port });
const handler = createOwnerAwareHandler(app.getRequestHandler());

app.prepare().then(() => {
  const server = http.createServer(handler);
  server.on("upgrade", app.getUpgradeHandler());
  server.listen(port, hostname, () => {
    console.log(`DurinDoor ${dev ? "development" : "production"} server ready on ${hostname}:${port}`);
  });
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
