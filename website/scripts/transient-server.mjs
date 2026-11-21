// Transient Playwright server for the website browser suite.
//
// The owner permits one host server for the browser tests and only while the
// tests run. This launcher keeps that promise mechanical instead of leaving
// it to convention:
//
//   * the server binds 127.0.0.1 only, never a wildcard address;
//   * it starts with the test run and exits with the run;
//   * it refuses to attach to a server that already exists;
//   * it creates no unit, schedule, service or daemon entry of any kind.
//
// Playwright starts this file through `webServer`, so the whole process tree
// belongs to the run and dies with it. Nothing here survives the run.

import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createConnection, createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

export const LOOPBACK_HOST = "127.0.0.1";
export const DEFAULT_TRANSIENT_PORT = 3100;
export const TRANSIENT_PORT_ENV = "WEBSITE_TRANSIENT_PORT";
export const TRANSIENT_STATE_ENV = "WEBSITE_TRANSIENT_STATE_FILE";

const WEBSITE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const NEXT_BIN = join(WEBSITE_ROOT, "node_modules", "next", "dist", "bin", "next");
const TRANSIENT_SCRIPT = join(WEBSITE_ROOT, "scripts", "transient-server.mjs");

export function isLoopbackHost(hostname) {
  return (
    hostname === LOOPBACK_HOST ||
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

// Only loopback origins qualify. A wildcard or routable host would expose the
// server beyond this machine, and a remote origin would be an existing server
// this run does not own.
export function isLoopbackUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && isLoopbackHost(url.hostname);
  } catch {
    return false;
  }
}

export function resolveTransientPort(env = process.env) {
  const raw = env[TRANSIENT_PORT_ENV];
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return DEFAULT_TRANSIENT_PORT;
  }
  const port = Number(String(raw).trim());
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `${TRANSIENT_PORT_ENV} must be an integer port between 1 and 65535, received ${raw}`,
    );
  }
  return port;
}

// The state file records which process this run started, so the suite can
// prove it talks to its own server instead of a leftover one.
export function transientStatePath(pid = process.pid) {
  return join(tmpdir(), `durindoor-website-transient-server-${pid}.json`);
}

// One plan, shared by the Playwright config and the launcher. The port is
// explicit on both sides so the browser target and the bound socket cannot
// drift apart.
export function transientServerPlan({
  port = resolveTransientPort(),
  host = LOOPBACK_HOST,
} = {}) {
  const baseURL = `http://${host}:${port}`;
  return {
    host,
    port,
    baseURL,
    url: baseURL,
    command: `${process.execPath} ${TRANSIENT_SCRIPT} --port ${port}`,
    env: {
      [TRANSIENT_PORT_ENV]: String(port),
      HOSTNAME: host,
      PORT: String(port),
      NEXT_TELEMETRY_DISABLED: "1",
    },
    nextArgs: ["start", "--hostname", host, "--port", String(port)],
  };
}

// Reports whether something already answers on the loopback port. A server
// bound to a wildcard address also answers here, which is exactly the case
// this run must refuse.
export function isPortListening(host, port, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const finish = (listening) => {
      socket.destroy();
      resolve(listening);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

// Reserves a free loopback port. Used by the tests that need a port nobody
// else holds.
export function reserveLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, LOOPBACK_HOST, () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

// Starts the server process and owns its lifetime. `stop()` ends the process
// group this run created; it never touches a process it did not start.
export function startTransientServer({
  command,
  args,
  cwd = WEBSITE_ROOT,
  env = {},
} = {}) {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "inherit", "inherit"],
  });
  const exited = new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  return {
    child,
    exited,
    pid: child.pid,
    async stop({ timeoutMs = 5000 } = {}) {
      if (child.exitCode !== null || child.signalCode !== null) return exited;
      child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
      try {
        return await exited;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

function parsePortArgument(argv) {
  const index = argv.indexOf("--port");
  if (index === -1) return undefined;
  return argv[index + 1];
}

function writeStateFile(path, state) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

function removeStateFile(path) {
  try {
    rmSync(path, { force: true });
  } catch {
    // A stale state file is harmless; the next run writes its own.
  }
}

async function main(argv) {
  const argument = parsePortArgument(argv);
  const port = resolveTransientPort({
    ...process.env,
    [TRANSIENT_PORT_ENV]: argument ?? process.env[TRANSIENT_PORT_ENV],
  });
  const plan = transientServerPlan({ port });

  if (await isPortListening(LOOPBACK_HOST, port)) {
    process.stderr.write(
      `Refusing to reuse the existing server on ${plan.baseURL}. ` +
        `Stop it, or choose another port with ${TRANSIENT_PORT_ENV}.\n`,
    );
    return 1;
  }

  const statePath = process.env[TRANSIENT_STATE_ENV] || transientStatePath();
  const server = startTransientServer({
    command: process.execPath,
    args: [NEXT_BIN, ...plan.nextArgs],
    cwd: WEBSITE_ROOT,
    env: plan.env,
  });

  writeStateFile(statePath, {
    pid: server.pid,
    port,
    host: plan.host,
    url: plan.url,
    startedAt: new Date().toISOString(),
  });

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await server.stop();
    removeStateFile(statePath);
  };

  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.on(signal, () => {
      stop().then(
        () => process.exit(0),
        () => process.exit(1),
      );
    });
  }

  const result = await server.exited;
  removeStateFile(statePath);
  // A shutdown signal is a normal end of the run, not a failure.
  if (stopping) return 0;
  return result.code ?? 1;
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  process.exitCode = await main(process.argv.slice(2));
}
