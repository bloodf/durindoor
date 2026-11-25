"use strict";

const DEFAULT_SERVER_HOST = "127.0.0.1";
const DEFAULT_SERVER_PORT = 20128;

/** Resolve and validate the dashboard listen address for every entry point. */
function resolveListenConfig({ argv = process.argv, env = process.env, dev = false, host, port } = {}) {
  const portIndex = argv.indexOf("--port");
  const rawPort = port ?? (env.PORT || (portIndex >= 0 ? argv[portIndex + 1] : dev ? 20127 : DEFAULT_SERVER_PORT));
  const resolvedPort = Number(rawPort);
  if (!Number.isSafeInteger(resolvedPort) || resolvedPort < 1 || resolvedPort > 65535) throw new Error("Invalid server port");
  return { port: resolvedPort, host: host || env.HOSTNAME || DEFAULT_SERVER_HOST };
}

module.exports = { DEFAULT_SERVER_HOST, DEFAULT_SERVER_PORT, resolveListenConfig };
