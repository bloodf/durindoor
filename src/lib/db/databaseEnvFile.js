import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DATA_DIR } from "../dataDir.js";

export const DATABASE_ENV_KEYS = ["DURINDOOR_DATABASE_ENGINE", "DURINDOOR_PG_URL", "DURINDOOR_PG_SSLMODE"];
const SOURCE_KEY = "DURINDOOR_DATABASE_ENV_SOURCE_JSON";
let applied = false;

export function databaseEnvFilePath() {
  return path.join(DATA_DIR, "durindoor-database.env");
}

export function readDatabaseEnvFile() {
  let text;
  try { text = fs.readFileSync(databaseEnvFilePath(), "utf8"); }
  catch (error) { if (error.code === "ENOENT") return {}; throw error; }
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Z_]+)=(.*)$/);
    if (match && DATABASE_ENV_KEYS.includes(match[1])) values[match[1]] = match[2];
  }
  return values;
}

function processSources() {
  if (process.env[SOURCE_KEY]) return JSON.parse(process.env[SOURCE_KEY]);
  return Object.fromEntries(DATABASE_ENV_KEYS.map((key) => [key, {
    source: Object.hasOwn(process.env, key) ? "process" : null,
    ...(Object.hasOwn(process.env, key) ? { processValue: process.env[key] } : {}),
  }]));
}

/** Apply once per startup, not again after a dashboard save awaiting restart. */
export function applyDatabaseEnvFile() {
  const values = readDatabaseEnvFile();
  if (applied) return values;
  const sources = processSources();
  for (const key of DATABASE_ENV_KEYS) {
    if (Object.hasOwn(values, key)) {
      process.env[key] = values[key];
      sources[key].source = "file";
    }
  }
  // An explicit managed SQLite selection must neutralize an inherited PG URL.
  // Otherwise the existing fail-closed URL-presence guard would select PG.
  if (values.DURINDOOR_DATABASE_ENGINE === "sqlite") {
    delete process.env.DURINDOOR_PG_URL;
    delete process.env.DURINDOOR_PG_SSLMODE;
  }
  process.env[SOURCE_KEY] = JSON.stringify(sources);
  applied = true;
  return values;
}

export function writeDatabaseEnvFile(partial) {
  const values = readDatabaseEnvFile();
  for (const key of DATABASE_ENV_KEYS) {
    if (!Object.hasOwn(partial, key)) continue;
    const value = partial[key];
    if (value === null) delete values[key];
    else {
      if (typeof value !== "string" || /[\r\n\0]/.test(value)) throw new Error("Invalid database environment value");
      values[key] = value;
    }
  }
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  fs.chmodSync(DATA_DIR, 0o700);
  const target = databaseEnvFilePath();
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, DATABASE_ENV_KEYS.filter((key) => Object.hasOwn(values, key))
      .map((key) => `${key}=${values[key]}\n`).join(""), { mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, target);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
  return values;
}

export function describeDatabaseEnv() {
  const values = readDatabaseEnvFile();
  const sources = processSources();
  return {
    path: databaseEnvFilePath(),
    exists: fs.existsSync(databaseEnvFilePath()),
    keys: Object.fromEntries(DATABASE_ENV_KEYS.map((key) => [key, {
      source: Object.hasOwn(values, key) ? "file" : Object.hasOwn(sources[key], "processValue") ? "process" : null,
      hasFileValue: Object.hasOwn(values, key),
      hasProcessValue: Object.hasOwn(sources[key], "processValue"),
    }])),
  };
}

/** Pending startup values are redacted; runtime connections remain unchanged until restart. */
export function describeDatabaseStartup(fallbackUrl) {
  const file = readDatabaseEnvFile();
  const sources = processSources();
  const value = (key) => file[key] ?? sources[key]?.processValue;
  const engine = value("DURINDOOR_DATABASE_ENGINE");
  const effective = { engine: engine || (value("DURINDOOR_PG_URL") || fallbackUrl ? "postgres" : "sqlite"), sslmode: value("DURINDOOR_PG_SSLMODE") || "require" };
  if (effective.engine !== "sqlite") {
    try {
      const url = new URL(value("DURINDOOR_PG_URL") ?? fallbackUrl);
      Object.assign(effective, { host: url.hostname, port: url.port || "5432", database: decodeURIComponent(url.pathname.slice(1)), user: decodeURIComponent(url.username), sslmode: url.searchParams.get("sslmode") || effective.sslmode });
    } catch { /* Invalid URLs are never echoed back. */ }
  }
  return { ...describeDatabaseEnv(), effective };
}

/** Build a candidate without ever returning its password to the client. */
export function composeDatabaseStartup(body) {
  if (!body || typeof body !== "object" || Array.isArray(body) || !["sqlite", "postgres"].includes(body.engine)) throw new Error("engine must be sqlite or postgres");
  if (body.engine === "sqlite") return { DURINDOOR_DATABASE_ENGINE: "sqlite", DURINDOOR_PG_URL: null, DURINDOOR_PG_SSLMODE: null };
  for (const key of ["host", "database", "user"]) {
    if (typeof body[key] !== "string" || !body[key].trim() || /[\r\n\0]/.test(body[key])) throw new Error(`${key} is required`);
  }
  const port = String(body.port ?? "5432");
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error("port must be between 1 and 65535");
  const sslmode = body.sslmode ?? "require";
  if (!["disable", "require", "verify-full"].includes(sslmode)) throw new Error("Invalid sslmode");
  let password = body.password;
  if (password === undefined) {
    const stored = readDatabaseEnvFile().DURINDOOR_PG_URL;
    const inherited = processSources().DURINDOOR_PG_URL?.processValue;
    try { password = decodeURIComponent(new URL(stored ?? inherited).password); } catch { password = ""; }
  }
  if (typeof password !== "string" || /[\r\n\0]/.test(password)) throw new Error("Invalid password");
  const host = body.host.trim();
  if (/[\s/@?#]/.test(host)) throw new Error("Invalid host");
  let url;
  try {
    url = new URL(`postgresql://${host.includes(":") && !host.startsWith("[") ? `[${host}]` : host}:${port}/`);
    url.username = encodeURIComponent(body.user);
    url.password = encodeURIComponent(password);
    url.pathname = `/${encodeURIComponent(body.database)}`;
  } catch { throw new Error("Invalid host"); }
  return { DURINDOOR_DATABASE_ENGINE: "postgres", DURINDOOR_PG_URL: url.toString(), DURINDOOR_PG_SSLMODE: sslmode };
}
