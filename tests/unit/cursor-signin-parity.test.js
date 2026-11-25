import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

const mocks = vi.hoisted(() => ({ create: vi.fn(), local: vi.fn() }));
vi.mock("@/lib/localDb", () => ({ createProviderConnection: mocks.create }));
vi.mock("@/lib/oauth/services/cursorLocalStore.js", () => ({ findAndReadCursorLocalAuth: mocks.local }));

import { POST } from "../../src/app/api/oauth/cursor/import/route.js";

const token = "synthetic-token-" + "x".repeat(50);
const machineId = "a".repeat(32);
const request = (body) => new Request("http://localhost/api/oauth/cursor/import", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});

describe("Cursor user-authorized import", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

  it("stores the supplied synthetic session without a provider request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("outbound disabled"));
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    mocks.create.mockImplementation(async (connection) => ({ ...connection, id: "synthetic-id" }));
    const response = await POST(request({ accessToken: ` ${token} `, machineId: ` ${machineId} `, cachedEmail: "test@example.invalid" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, connection: { id: "synthetic-id", provider: "cursor", email: "test@example.invalid" } });
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: token, refreshToken: null, expiresAt: "2023-11-15T22:13:20.000Z",
      providerSpecificData: expect.objectContaining({ machineId, authMethod: "imported" }),
    }));
    expect(mocks.local).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads synthetic values from an isolated Cursor store", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cursor-import-test-"));
    try {
      const dbPath = join(dir, "state.vscdb");
      const db = new Database(dbPath);
      db.exec("CREATE TABLE itemTable (key TEXT PRIMARY KEY, value TEXT)");
      const insert = db.prepare("INSERT INTO itemTable VALUES (?, ?)");
      insert.run("cursorAuth/accessToken", JSON.stringify(token));
      insert.run("storage.serviceMachineId", machineId);
      insert.run("cursorAuth/cachedEmail", "test@example.invalid");
      db.close();
      const { readCursorLocalAuthSync } = await vi.importActual("@/lib/oauth/services/cursorLocalStore.js");
      expect(readCursorLocalAuthSync(dbPath)).toEqual({ accessToken: token, machineId, cachedEmail: "test@example.invalid" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects missing fields before accessing storage", async () => {
    const response = await POST(request({ accessToken: token }));
    expect(response.status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.local).not.toHaveBeenCalled();
  });
});
