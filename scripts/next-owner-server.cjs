#!/usr/bin/env node

const path = require("path");
const http = require("http");
const {
  canonicalizeRuntimePaths,
  createGatewayServer,
  resolveListenConfig,
  setProcessTitle,
} = require("../custom-server");

const dev = process.argv.includes("--dev");
if (dev) process.env.NODE_ENV = "development";
canonicalizeRuntimePaths();
const next = require("next");
// Security: bind to loopback by default; the dashboard runs privileged system
// commands and must not be reachable from the public internet. Set HOSTNAME=0.0.0.0
// to expose it deliberately behind your own auth/proxy (#2725).
const { port, host: hostname } = resolveListenConfig({ argv: process.argv, env: process.env, dev });

process.env.PORT = String(port);
setProcessTitle();

const app = next({ dev, webpack: true, dir: path.resolve(__dirname, ".."), hostname, port });
app.prepare().then(() => {
  const server = createGatewayServer(app.getRequestHandler(), { httpModule: http, dashboardPort: port, upgradeHandler: app.getUpgradeHandler() });
  server.listen(port, hostname, () => {
    console.log(`DurinDoor ${dev ? "development" : "production"} server ready on ${hostname}:${port}`);
  });
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
