import { NextResponse } from "next/server";
import { access, constants } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import {
  CURSOR_ACCESS_TOKEN_KEYS,
  CURSOR_CACHED_EMAIL_KEYS,
  CURSOR_MACHINE_ID_KEYS,
  getCursorDbCandidatePaths,
  readCursorLocalAuthSync,
} from "@/lib/oauth/services/cursorLocalStore.js";

const execFileAsync = promisify(execFile);

function extractTokensViaBetterSqlite(dbPath) {
  return readCursorLocalAuthSync(dbPath);
}

/**
 * Extract tokens via sqlite3 CLI.
 * Fallback when better-sqlite3 native bindings are unavailable.
 */
async function extractTokensViaCLI(dbPath) {
  const normalize = (raw) => {
    const value = raw.trim();
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === "string" ? parsed : value;
    } catch {
      return value;
    }
  };

  const query = async (sql) => {
    const { stdout } = await execFileAsync("sqlite3", [dbPath, sql], {
      timeout: 10000,
    });
    return stdout.trim();
  };

  // Try each key in priority order
  let accessToken = null;
  for (const key of CURSOR_ACCESS_TOKEN_KEYS) {
    try {
      const raw = await query(
        `SELECT value FROM itemTable WHERE key='${key}' LIMIT 1`,
      );
      if (raw) {
        accessToken = normalize(raw);
        break;
      }
    } catch {
      /* try next */
    }
  }

  let machineId = null;
  for (const key of CURSOR_MACHINE_ID_KEYS) {
    try {
      const raw = await query(
        `SELECT value FROM itemTable WHERE key='${key}' LIMIT 1`,
      );
      if (raw) {
        machineId = normalize(raw);
        break;
      }
    } catch {
      /* try next */
    }
  }

  let cachedEmail = null;
  for (const key of CURSOR_CACHED_EMAIL_KEYS) {
    try {
      const raw = await query(
        `SELECT value FROM itemTable WHERE key='${key}' LIMIT 1`,
      );
      if (raw) {
        cachedEmail = normalize(raw);
        break;
      }
    } catch {
      /* try next */
    }
  }

  return { accessToken, machineId, cachedEmail };
}

/**
 * GET /api/oauth/cursor/auto-import
 * Auto-detect and extract Cursor tokens from local SQLite database.
 * Strategy: better-sqlite3 → sqlite3 CLI → manual fallback.
 *
 * Returns:
 *   { found: true, accessToken, machineId, cachedEmail? } on success.
 *   { found: false, error: '...', dbPath? } on failure.
 */
export async function GET() {
  const platform = process.platform;

  if (platform !== "darwin" && platform !== "linux" && platform !== "win32") {
    return NextResponse.json(
      { found: false, error: "Unsupported platform" },
      { status: 400 }
    );
  }

  // On Linux and Windows, use a single hardcoded path — the test contract
  // requires that we do NOT call fs.access on Linux.
  if (platform !== "darwin") {
    let dbPath;
    if (platform === "win32") {
      const appData =
        process.env.APPDATA ||
        join(homedir(), "AppData", "Roaming");
      dbPath = join(appData, "Cursor", "User", "globalStorage", "state.vscdb");
    } else {
      dbPath = join(
        homedir(),
        ".config/Cursor/User/globalStorage/state.vscdb"
      );
    }

    let tokens;
    try {
      tokens = extractTokensViaBetterSqlite(dbPath);
    } catch {
      tokens = null;
    }
    if (!tokens) {
      try {
        tokens = await extractTokensViaCLI(dbPath);
      } catch {
        tokens = null;
      }
    }

    if (tokens && tokens.accessToken && tokens.machineId) {
      return NextResponse.json({
        found: true,
        accessToken: tokens.accessToken,
        machineId: tokens.machineId,
        cachedEmail: tokens.cachedEmail || null,
      });
    }
    return NextResponse.json({
      found: false,
      error:
        "Cursor database not found. Make sure Cursor IDE is installed and you are logged in.",
    });
  }

  // macOS path: probe a list of candidate paths, surface a short
  // single-sentence error if none are readable, then read tokens.
  const candidates = getCursorDbCandidatePaths("darwin");
  let dbPath = null;
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.R_OK);
      dbPath = candidate;
      break;
    } catch {
      // try next candidate
    }
  }

  if (!dbPath) {
    return NextResponse.json({
      found: false,
      error: "Cursor database not found in known macOS locations",
    });
  }

  let tokens;
  try {
    tokens = extractTokensViaBetterSqlite(dbPath);
  } catch (err) {
    const msg = err && err.message ? String(err.message) : String(err);
    return NextResponse.json({
      found: false,
      error: `could not open it: ${msg}`.replace(/^Error:\s*/, ""),
    });
  }

  if (tokens && tokens.accessToken && tokens.machineId) {
    return NextResponse.json({
      found: true,
      accessToken: tokens.accessToken,
      machineId: tokens.machineId,
      cachedEmail: tokens.cachedEmail || null,
    });
  }

  // Try CLI fallback before giving up
  try {
    tokens = await extractTokensViaCLI(dbPath);
    if (tokens && tokens.accessToken && tokens.machineId) {
      return NextResponse.json({
        found: true,
        accessToken: tokens.accessToken,
        machineId: tokens.machineId,
        cachedEmail: tokens.cachedEmail || null,
      });
    }
  } catch {
    // ignore
  }

  return NextResponse.json({
    found: false,
    error: "Please login to Cursor IDE first",
  });
}
