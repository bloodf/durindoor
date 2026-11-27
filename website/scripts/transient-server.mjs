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
//
// "Dies with it" has to hold even when the run does not end politely.
// Playwright gives the web server its own process group, so a runner killed
// with SIGKILL (a timed-out local-ci shard, for one) never gets to stop it.
// The launcher therefore watches the runner PID it was given and stops its
// server as soon as that runner is gone. The runner's kernel start time is
// recorded at launch, so a recycled PID does not keep a leftover alive.
//
// Every process in the tree inherits the run's owner token
// (WEBSITE_TRANSIENT_OWNER). local-ci uses it to prove ownership before it
// signals anything; see scripts/lib/website-shard-server.mjs.

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createConnection, createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

export const LOOPBACK_HOST = "127.0.0.1";
export const DEFAULT_TRANSIENT_PORT = 3100;
export const TRANSIENT_PORT_ENV = "WEBSITE_TRANSIENT_PORT";
export const TRANSIENT_STATE_ENV = "WEBSITE_TRANSIENT_STATE_FILE";
export const TRANSIENT_OWNER_ENV = "WEBSITE_TRANSIENT_OWNER";
export const TRANSIENT_RUNNER_ENV = "WEBSITE_TRANSIENT_RUNNER_PID";
const OWNER_RE = /^[a-f0-9]{32}$/;

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

// local-ci supplies one token per shard. A direct `playwright test` run gets
// a fresh one so its server tree is just as identifiable.
export function resolveTransientOwner(env = process.env) {
  const raw = env[TRANSIENT_OWNER_ENV];
  if (raw === undefined || raw === "") return randomBytes(16).toString("hex");
  if (!OWNER_RE.test(raw)) throw new Error(`${TRANSIENT_OWNER_ENV} must be 32 lowercase hex characters`);
  return raw;
}

// Kernel start time (clock ticks since boot) of a PID, or null when it is not
// readable. A PID plus its start time names one process for its whole life.
export function processStartTime(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return fields[0] === "Z" ? null : fields[19];
  } catch {
    return null;
  }
}

export function processAlive(pid, startTime = null) {
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (error.code !== "EPERM") return false;
  }
  if (startTime === null) return true;
  return processStartTime(pid) === startTime;
}

// Calls onGone once the runner exits. Returns a function that stops watching.
export function watchRunner(pid, { intervalMs = 250, onGone } = {}) {
  if (!Number.isInteger(pid) || pid <= 1) throw new Error("invalid runner PID");
  const startTime = processStartTime(pid);
  const timer = setInterval(() => {
    if (processAlive(pid, startTime)) return;
    clearInterval(timer);
    onGone();
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

// One plan, shared by the Playwright config and the launcher. The port is
// explicit on both sides so the browser target and the bound socket cannot
// drift apart.
export function transientServerPlan({
  port = resolveTransientPort(),
  host = LOOPBACK_HOST,
  owner = resolveTransientOwner(),
} = {}) {
  const baseURL = `http://${host}:${port}`;
  return {
    host,
    port,
    baseURL,
    url: baseURL,
    command: `${process.execPath} ${TRANSIENT_SCRIPT} --port ${port}`,
    owner,
    env: {
      [TRANSIENT_OWNER_ENV]: owner,
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
  const plan = transientServerPlan({ port, owner: resolveTransientOwner() });

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
    serverStartTime: processStartTime(server.pid),
    launcherPid: process.pid,
    launcherStartTime: processStartTime(process.pid),
    owner: plan.owner,
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

  // A runner that vanished without stopping us (SIGKILL, OOM) must not leave
  // the server holding the port.
  const runnerPid = Number(process.env[TRANSIENT_RUNNER_ENV]);
  if (Number.isInteger(runnerPid) && runnerPid > 1) {
    watchRunner(runnerPid, {
      onGone: () => {
        process.stderr.write(`Playwright runner ${runnerPid} is gone; stopping the transient server.\n`);
        stop().then(
          () => process.exit(0),
          () => process.exit(1),
        );
      },
    });
  }

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
