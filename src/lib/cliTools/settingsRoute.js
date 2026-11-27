/**
 * One GET/POST/DELETE handler for CLI tools whose DurinDoor integration is a single
 * config file merge (#2287). A route supplies a declarative descriptor:
 *
 * - `id`: lowercase tool id, used for `which <id>` and in log/error text ("<id> settings").
 * - `displayName`: shown in user messages ("<displayName> settings applied successfully!").
 * - `resolvePath()`: async or sync; the config file to read and write.
 * - `format`: `"json"` or `"toml"` (see FORMATS).
 * - `header`: optional text prepended to the file on apply only.
 * - `secretFields`: config keys holding credentials; always redacted in GET.
 * - `isConfigured(raw, config)`: whether the file already points at DurinDoor.
 * - `apply(existing, body)`: async or sync; returns the full object to write.
 * - `reset(existing)`: returns the object to write, or null when nothing changes.
 * - `resetOnlyWhenConfigured`: refuse to touch a file `isConfigured` does not claim.
 * - `removeWhenEmpty`: delete the file instead of writing `{}` on reset.
 * - `messages`: optional overrides for `notInstalled` and `applied`.
 *
 * Reads go through readExistingConfig (refuses to overwrite an unparseable file) and writes
 * through writeConfigAtomic (refuses a file owned by another uid, CLI_CONFIG_FOREIGN_OWNER).
 * Both failures surface as a 500 carrying the error message, as the per-route copies did.
 */

import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { exec } from "child_process";
import { promisify } from "util";
import { parseTOML, stringifyTOML } from "confbox";
import { redactSecrets, REDACTED_SECRET } from "@/shared/utils/secretRedaction";
import { isObject } from "@/shared/utils/typeChecks";
import { readExistingConfig, writeConfigAtomic } from "@/lib/cliTools/readExistingConfig";

const execAsync = promisify(exec);

export const isPlainObject = (value) => value !== null && isObject(value) && !Array.isArray(value);

const asObject = (parsed) => {
  if (!isPlainObject(parsed)) throw new Error("expected an object");
  return parsed;
};

/**
 * `parseStatus` feeds GET only: JSON status reads accept any JSON value, TOML reads require
 * a table. `parse` guards writes and must yield a plain object.
 */
const FORMATS = {
  json: {
    parseStatus: (raw) => JSON.parse(raw),
    parse: (raw) => asObject(JSON.parse(raw)),
    stringify: (value) => JSON.stringify(value, null, 2),
  },
  toml: {
    parseStatus: (raw) => asObject(parseTOML(raw)),
    parse: (raw) => asObject(parseTOML(raw)),
    stringify: (value) => stringifyTOML(value),
  },
};

/** Append `/v1` unless the base URL already ends with it. */
export const withV1 = (baseUrl) => (baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`);

const redactFields = (value, fields) => {
  if (Array.isArray(value)) return value.map((child) => redactFields(child, fields));
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    fields.has(key) && child != null && child !== "" ? REDACTED_SECRET : redactFields(child, fields),
  ]));
};

/**
 * @param {object} descriptor see the module comment
 * @returns {{ GET: () => Promise<Response>, POST: (request: Request) => Promise<Response>, DELETE: () => Promise<Response> }}
 */
export function createSettingsRoute(descriptor) {
  const {
    id,
    displayName,
    resolvePath,
    header = "",
    secretFields = [],
    isConfigured,
    apply,
    reset,
    resetOnlyWhenConfigured = false,
    removeWhenEmpty = false,
    messages = {},
  } = descriptor;
  const format = FORMATS[descriptor.format];
  if (!format) throw new Error(`Unknown CLI config format: ${descriptor.format}`);
  const secrets = new Set(secretFields);

  const isInstalled = async () => {
    try {
      await execAsync(os.platform() === "win32" ? `where ${id}` : `which ${id}`, { windowsHide: true });
      return true;
    } catch {
      return fs.access(await resolvePath()).then(() => true, () => false);
    }
  };

  /** GET — report install state, redacted config, and whether DurinDoor is configured. */
  async function GET() {
    try {
      if (!(await isInstalled())) {
        return NextResponse.json({
          installed: false,
          config: null,
          message: messages.notInstalled ?? `${displayName} CLI is not installed`,
        });
      }
      const configPath = await resolvePath();
      let raw = null;
      let config = null;
      try {
        raw = await fs.readFile(configPath, "utf-8");
        config = format.parseStatus(raw);
      } catch {
        /* absent or unparseable config reads as unconfigured */
      }
      return NextResponse.json({
        installed: true,
        config: redactFields(redactSecrets(config), secrets),
        has9Router: isConfigured(raw, config),
        configPath,
      });
    } catch (error) {
      console.log(`Error checking ${id} settings:`, error);
      return NextResponse.json({ error: `Failed to check ${id} settings` }, { status: 500 });
    }
  }

  /** POST — merge DurinDoor settings; refuses to overwrite an unparseable or foreign-owned file. */
  async function POST(request) {
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    try {
      const input = body || {};
      if (!input.baseUrl) return NextResponse.json({ error: "baseUrl is required" }, { status: 400 });

      const configPath = await resolvePath();
      const existing = (await readExistingConfig(configPath, format.parse)) ?? {};
      const updated = await apply(existing, input);

      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await writeConfigAtomic(configPath, header + format.stringify(updated), "utf-8");

      return NextResponse.json({
        success: true,
        message: messages.applied ?? `${displayName} settings applied successfully!`,
        configPath,
      });
    } catch (error) {
      console.log(`Error updating ${id} settings:`, error.message);
      return NextResponse.json({ error: error.message || `Failed to update ${id} settings` }, { status: 500 });
    }
  }

  /** DELETE — remove only what DurinDoor wrote; keep everything else. */
  async function DELETE() {
    try {
      const configPath = await resolvePath();
      let raw = "";
      const existing = await readExistingConfig(configPath, (content) => {
        raw = content;
        return format.parse(content);
      });
      if (!existing) return NextResponse.json({ success: true, message: "No config file to reset" });
      if (resetOnlyWhenConfigured && !isConfigured(raw, existing)) {
        return NextResponse.json({ success: true, message: `${displayName} is not configured for DurinDoor` });
      }

      const next = reset(existing);
      if (next && removeWhenEmpty && Object.keys(next).length === 0) {
        await fs.rm(configPath, { force: true });
      } else if (next) {
        await writeConfigAtomic(configPath, format.stringify(next), "utf-8");
      }

      return NextResponse.json({ success: true, message: `DurinDoor removed from ${displayName}` });
    } catch (error) {
      console.log(`Error resetting ${id} settings:`, error.message);
      return NextResponse.json({ error: error.message || `Failed to reset ${id} settings` }, { status: 500 });
    }
  }

  return { GET, POST, DELETE };
}
