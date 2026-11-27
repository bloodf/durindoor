// Private browser profiles for the staged Firefly web UI flow (#2034).
//
// One profile per (connection, server-created handle), at
// DATA_DIR/browser-profiles/adobe-firefly-web/<connectionId>/<profileHandle>.
// The handle is minted here, never taken from a client, and a marker file in
// the profile binds it to its connection. Every use re-checks the id shapes,
// path containment, that no component is a symlink, and the marker. There is
// no shared default profile and no caller-chosen path. Profiles are never
// deleted automatically.
//
// Setup and generation are mutually exclusive per profile: a second user of
// a busy profile gets 409 before any browser launch. The lock is in-process
// only; one DurinDoor process owns DATA_DIR.
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { ADOBE_FIREFLY_WEB_ID } from "../../providers/registry/adobe-firefly-web.js";
import { PROFILE_HANDLE_PATTERN, reject } from "./config.js";
import { isRecord, isString } from "../../../src/shared/utils/typeChecks.js";

export const PROFILE_MARKER = ".durindoor-firefly-profile.json";
const CONNECTION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

const profileError = (message) => reject(409, `Adobe Firefly web UI ${message}`, "needs_operator");

export function profileRoot(dataDir) {
  if (!isString(dataDir) || !path.isAbsolute(dataDir)) throw reject(500, "Adobe Firefly web UI needs an absolute data directory", "invalid");
  return path.join(path.resolve(dataDir), "browser-profiles", ADOBE_FIREFLY_WEB_ID);
}

export function assertConnectionId(connectionId) {
  if (!isString(connectionId) || !CONNECTION_ID.test(connectionId)) {
    throw reject(400, "Adobe Firefly web UI needs a stored connection with a safe id", "invalid");
  }
  return connectionId;
}

function assertHandle(handle) {
  if (!isString(handle) || !PROFILE_HANDLE_PATTERN.test(handle)) throw profileError("profile handle is not a server-created handle");
  return handle;
}

/** The profile directory for this pair, contained in the provider's root. */
export function profileDir(dataDir, connectionId, handle) {
  const root = profileRoot(dataDir);
  const dir = path.resolve(root, assertConnectionId(connectionId), assertHandle(handle));
  if (path.relative(root, dir) !== path.join(connectionId, handle)) throw profileError("profile path escapes its root");
  return dir;
}

// No component from DATA_DIR down may be a symlink, so the profile cannot be
// redirected to another account's directory or outside DATA_DIR.
function assertNoSymlinks(dataDir, dir) {
  let current = path.resolve(dataDir);
  for (const part of path.relative(current, dir).split(path.sep)) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current, { throwIfNoEntry: false });
    if (!stat) throw profileError("browser profile is not initialized");
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw profileError("browser profile path is not a private directory");
  }
}

function readMarker(dir) {
  const file = path.join(dir, PROFILE_MARKER);
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!stat || !stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) throw profileError("browser profile marker is missing");
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw profileError("browser profile marker is unreadable");
  }
}

/**
 * Verify an initialized profile for this pair and return its directory.
 * Throws 409 needs_operator for a missing, moved, tampered or mismatched one.
 */
export function resolveProfile({ dataDir, connectionId, profileHandle }) {
  const dir = profileDir(dataDir, connectionId, profileHandle);
  assertNoSymlinks(dataDir, dir);
  const marker = readMarker(dir);
  if (!isRecord(marker) || marker.provider !== ADOBE_FIREFLY_WEB_ID || marker.connectionId !== connectionId || marker.profileHandle !== profileHandle) {
    throw profileError("browser profile marker does not match this connection");
  }
  return dir;
}

/**
 * Create a new private profile for a connection that has none and return its
 * server-created handle, for the caller to store as
 * providerSpecificData.fireflyWebUi.profileHandle. A handle is immutable: a
 * connection that already has one is refused, so a profile is never
 * reassigned or replaced here.
 */
export function initializeProfile({ dataDir, connectionId, existingHandle, randomHandle = () => randomBytes(16).toString("hex") }) {
  assertConnectionId(connectionId);
  if (existingHandle !== undefined && existingHandle !== null && existingHandle !== "") {
    throw reject(409, "Adobe Firefly web UI profile handle already exists and cannot be replaced", "conflict");
  }
  const handle = assertHandle(randomHandle());
  const root = profileRoot(dataDir);
  fs.mkdirSync(path.join(root, connectionId), { recursive: true, mode: 0o700 });
  // Checked before the profile directory is created through any of them.
  assertNoSymlinks(dataDir, path.join(root, connectionId));
  const dir = profileDir(dataDir, connectionId, handle);
  fs.mkdirSync(dir, { mode: 0o700 });
  assertNoSymlinks(dataDir, dir);
  fs.writeFileSync(path.join(dir, PROFILE_MARKER), JSON.stringify({
    provider: ADOBE_FIREFLY_WEB_ID,
    connectionId,
    profileHandle: handle,
    createdAt: new Date().toISOString(),
  }), { flag: "wx", mode: 0o600 });
  return { profileHandle: handle };
}

const busy = new Map();

/**
 * Take the profile for `mode` ("setup" or "generation"). Returns a release
 * function that frees it once; a busy profile throws 409 before any launch.
 */
export function acquireProfile(dir, mode) {
  if (busy.has(dir)) throw reject(409, `Adobe Firefly web UI profile is busy (${busy.get(dir)})`, "busy");
  busy.set(dir, mode);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    busy.delete(dir);
  };
}

export const profileBusy = (dir) => busy.has(dir);
