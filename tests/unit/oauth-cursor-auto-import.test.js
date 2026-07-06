import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fsPromises from "fs/promises";

// Mock next/server
vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body, init) => ({
      status: init?.status || 200,
      body,
      json: async () => body,
    })),
  },
}));

// Mock os
vi.mock("os", () => ({
  default: { homedir: vi.fn(() => "/mock/home") },
  homedir: vi.fn(() => "/mock/home"),
}));

// Mock fs/promises
vi.mock("fs/promises", () => ({
  access: vi.fn(),
  constants: { R_OK: 4 },
}));

// Shared mock db instance
const mockDbInstance = {
  prepare: vi.fn(),
  close: vi.fn(),
  __throwOnConstruct: false,
};

// Mock the cursorLocalStore service (not "better-sqlite3" directly): the
// service lazy-loads better-sqlite3 via createRequire(), which bypasses
// Vitest's ESM module-graph mocking entirely, so a `vi.mock("better-sqlite3")`
// never intercepts it. Mocking the service module route.js actually imports
// lets tests drive `mockDbInstance` deterministically.
vi.mock("../../src/lib/oauth/services/cursorLocalStore.js", () => {
  const ACCESS_TOKEN_KEYS = ["cursorAuth/accessToken", "cursorAuth/token"];
  const MACHINE_ID_KEYS = [
    "storage.serviceMachineId",
    "telemetry.machineId",
    "telemetry.devDeviceId",
  ];
  const CACHED_EMAIL_KEYS = ["cursorAuth/cachedEmail"];

  function normalizeStoredValue(value) {
    if (typeof value !== "string") return value;
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === "string" ? parsed : value;
    } catch {
      return value;
    }
  }

  function queryFirst(db, keys) {
    if (!keys || keys.length === 0) return null;
    const placeholders = keys.map(() => "?").join(",");
    try {
      const rows = db
        .prepare(`SELECT value, key FROM itemTable WHERE key IN (${placeholders})`)
        .all(...keys);
      for (const key of keys) {
        const hit = rows.find((r) => r && r.key === key && r.value);
        if (hit) return normalizeStoredValue(hit.value);
      }
    } catch {
      // ignore — fall through to fuzzy
    }
    for (const key of keys) {
      const prefix = key.split(/[/.]/)[0];
      if (!prefix) continue;
      try {
        for (const sep of ["/", "."]) {
          const rows = db
            .prepare("SELECT value, key FROM itemTable WHERE key LIKE ?")
            .all(prefix + sep + "%");
          const hit = rows.find(
            (r) => r && r.value && typeof r.key === "string" && r.key.startsWith(prefix + sep)
          );
          if (hit) return normalizeStoredValue(hit.value);
        }
      } catch {
        // ignore
      }
    }
    return null;
  }

  return {
    CURSOR_ACCESS_TOKEN_KEYS: ACCESS_TOKEN_KEYS,
    CURSOR_MACHINE_ID_KEYS: MACHINE_ID_KEYS,
    CURSOR_CACHED_EMAIL_KEYS: CACHED_EMAIL_KEYS,
    getCursorDbCandidatePaths: (platform = "darwin") => {
      if (platform === "darwin") {
        return [
          "/mock/home/Library/Application Support/Cursor/User/globalStorage/state.vscdb",
          "/mock/home/Library/Application Support/Cursor - Insiders/User/globalStorage/state.vscdb",
        ];
      }
      return ["/mock/home/.config/Cursor/User/globalStorage/state.vscdb"];
    },
    readCursorLocalAuthSync: (_dbPath) => {
      if (mockDbInstance.__throwOnConstruct) {
        throw new Error("SQLITE_CANTOPEN: unable to open database file");
      }
      try {
        return {
          accessToken: queryFirst(mockDbInstance, ACCESS_TOKEN_KEYS),
          machineId: queryFirst(mockDbInstance, MACHINE_ID_KEYS),
          cachedEmail: queryFirst(mockDbInstance, CACHED_EMAIL_KEYS),
        };
      } finally {
        mockDbInstance.close();
      }
    },
  };
});

// We need to dynamically import after mocks are registered
let GET;

describe("GET /api/oauth/cursor/auto-import", () => {
  const originalPlatform = process.platform;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDbInstance.__throwOnConstruct = false;
    // Force darwin so macOS-specific logic is exercised
    Object.defineProperty(process, "platform", { value: "darwin", writable: true });
    // Re-import to pick up fresh mocks each run
    const mod = await import("../../src/app/api/oauth/cursor/auto-import/route.js");
    GET = mod.GET;
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform, writable: true });
  });

  // ── macOS path probing ────────────────────────────────────────────────

  it("returns not-found when no macOS cursor db paths are accessible", async () => {
    vi.mocked(fsPromises.access).mockRejectedValue(new Error("ENOENT"));

    const response = await GET();

    expect(response.body.found).toBe(false);
    expect(response.body.error).toContain("Cursor database not found in known macOS locations");
  });

  it("returns descriptive error if macOS db file exists but cannot be opened", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    mockDbInstance.__throwOnConstruct = true;

    const response = await GET();

    expect(response.body.found).toBe(false);
    expect(response.body.error).toContain("could not open it");
    expect(response.body.error).toContain("SQLITE_CANTOPEN");
  });

  // ── Token extraction ──────────────────────────────────────────────────

  it("extracts tokens using exact keys", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    mockDbInstance.prepare.mockReturnValue({
      all: vi.fn().mockReturnValue([
        { key: "cursorAuth/accessToken", value: "test-token" },
        { key: "storage.serviceMachineId", value: "test-machine-id" },
      ]),
    });

    const response = await GET();

    expect(response.body.found).toBe(true);
    expect(response.body.accessToken).toBe("test-token");
    expect(response.body.machineId).toBe("test-machine-id");
    expect(mockDbInstance.close).toHaveBeenCalled();
  });

  it("unwraps JSON-encoded string values", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    mockDbInstance.prepare.mockReturnValue({
      all: vi.fn().mockReturnValue([
        { key: "cursorAuth/accessToken", value: '"json-token"' },
        { key: "storage.serviceMachineId", value: '"json-machine-id"' },
      ]),
    });

    const response = await GET();

    expect(response.body.found).toBe(true);
    expect(response.body.accessToken).toBe("json-token");
    expect(response.body.machineId).toBe("json-machine-id");
  });

  // ── Fuzzy fallback (macOS only) ───────────────────────────────────────

  it("falls back to fuzzy key matching on macOS when exact keys are missing", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    mockDbInstance.prepare.mockImplementation((query) => {
      if (query.includes("IN (")) {
        return { all: vi.fn().mockReturnValue([]) };
      }
      // Fuzzy LIKE query
      return {
        all: vi.fn().mockReturnValue([
          { key: "cursorAuth/someOtherAccessTokenKey", value: "fallback-token" },
          { key: "storage.someMachineId", value: "fallback-machine" },
        ]),
      };
    });

    const response = await GET();

    expect(response.body.found).toBe(true);
    expect(response.body.accessToken).toBe("fallback-token");
    expect(response.body.machineId).toBe("fallback-machine");
  });

  it("returns login-prompt error when tokens are missing even after fallback", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    mockDbInstance.prepare.mockReturnValue({
      all: vi.fn().mockReturnValue([]),
    });

    const response = await GET();

    expect(response.body.found).toBe(false);
    expect(response.body.error).toContain("Please login to Cursor IDE first");
  });

  // ── Backwards-compatible: linux/win32 keep original single-path logic ─

  it("linux uses single hardcoded path and original error message", async () => {
    Object.defineProperty(process, "platform", { value: "linux", writable: true });
    vi.mocked(fsPromises.access).mockRejectedValue(new Error("ENOENT"));
    mockDbInstance.__throwOnConstruct = true;

    const response = await GET();

    expect(response.body.found).toBe(false);
    expect(response.body.error).toBe(
      "Cursor database not found. Make sure Cursor IDE is installed and you are logged in."
    );
    // fs/promises.access should NOT have been called (linux skips probing)
    expect(fsPromises.access).not.toHaveBeenCalled();
  });

  it("unsupported platform returns 400", async () => {
    Object.defineProperty(process, "platform", { value: "freebsd", writable: true });

    const response = await GET();

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Unsupported platform");
  });
});
