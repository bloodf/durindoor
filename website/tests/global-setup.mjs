import { readFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { expect } from "@playwright/test";
import {
  LOOPBACK_HOST,
  TRANSIENT_STATE_ENV,
  isPortListening,
} from "../scripts/transient-server.mjs";

// The suite may use one host server, and only while it runs. These checks run
// before the first test and fail the run when the browser would talk to
// anything other than this run's own loopback-bound server.
export default async function globalSetup(config) {
  const baseURLs = [...new Set(config.projects.map((project) => project.use.baseURL).filter(Boolean))];
  expect(baseURLs.length, "the browser suite must target exactly one base URL").toBe(1);

  const baseURL = baseURLs[0];
  const url = new URL(baseURL);
  expect(url.protocol, "the browser suite must use plain HTTP on loopback").toBe("http:");
  expect(url.hostname, "the browser suite must target the loopback interface").toBe(LOOPBACK_HOST);

  // The state file names the process this run started. A server left over
  // from another run would not be in it, so the suite cannot inherit one.
  const statePath = process.env[TRANSIENT_STATE_ENV];
  expect(statePath, "the transient server state file must be configured").toBeTruthy();
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  expect(state.url, "the browser must reach this run's transient server").toBe(baseURL);
  expect(state.host, "the transient server must bind the loopback interface").toBe(LOOPBACK_HOST);
  expect(isProcessAlive(state.pid), "the transient server process must be running").toBe(true);

  // Binding to loopback means no other interface of this host answers on the
  // same port. A wildcard bind would answer here and fail the run.
  for (const address of hostIPv4Addresses()) {
    const listening = await isPortListening(address, Number(url.port));
    expect(
      listening,
      `${address}:${url.port} answered, so the server is reachable beyond ${LOOPBACK_HOST}`,
    ).toBe(false);
  }
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // A process owned by another user still exists.
    return error.code === "EPERM";
  }
}

function hostIPv4Addresses() {
  const addresses = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) addresses.push(entry.address);
    }
  }
  return addresses;
}
