import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ openError: null }));

vi.mock("next/server", () => ({
  NextResponse: { json: (body) => ({ body }) },
}));
vi.mock("fs/promises", () => ({ access: vi.fn(async () => {}), constants: { R_OK: 4 } }));
vi.mock("../../src/lib/oauth/services/cursorLocalStore.js", () => ({
  CURSOR_ACCESS_TOKEN_KEYS: [],
  CURSOR_MACHINE_ID_KEYS: [],
  CURSOR_CACHED_EMAIL_KEYS: [],
  getCursorDbCandidatePaths: () => ["/mock/state.vscdb"],
  readCursorLocalAuthSync: () => { throw mocks.openError; },
}));

const { GET } = await import("../../src/app/api/oauth/cursor/auto-import/route.js");
const originalPlatform = process.platform;

describe("port(upstream) #5238: Cursor auto-import open errors", () => {
  afterEach(() => Object.defineProperty(process, "platform", { value: originalPlatform, writable: true }));

  it.each([
    [new Error("SQLITE_CORRUPT: malformed row cursorAuth/accessToken=secret-token"), "could not open it (SQLITE_CORRUPT)"],
    [Object.assign(new Error("value secret-token"), { code: "SQLITE_BUSY" }), "could not open it (SQLITE_BUSY)"],
    [new Error("driver failed near secret-token"), "could not open it"],
  ])("reports only the SQLite code (%#)", async (openError, expected) => {
    Object.defineProperty(process, "platform", { value: "darwin", writable: true });
    mocks.openError = openError;

    expect((await GET()).body).toEqual({ found: false, error: expected });
  });
});
