import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { readCursorAuthFromDb } from "../../src/lib/oauth/services/cursorLocalStore.js";

function cursorDb(rows) {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE itemTable (key TEXT PRIMARY KEY, value TEXT)");
  const insert = db.prepare("INSERT INTO itemTable (key, value) VALUES (?, ?)");
  for (const row of Object.entries(rows)) insert.run(...row);
  return db;
}

describe("port(upstream) #5238: Cursor auto-import only reads the field it asked for", () => {
  it("does not import unrelated rows that share a key prefix", () => {
    const auth = readCursorAuthFromDb(cursorDb({
      "cursorAuth/refreshToken": "refresh-secret",
      "cursorAuth/stripeMembershipType": "pro",
      "storage.workspaceHistory": "private-history",
      "telemetry.sqmId": "sqm",
    }));
    expect(auth).toEqual({ accessToken: null, machineId: null, cachedEmail: null });
  });

  it("still finds renamed token, machine id and email keys behind many unrelated rows", () => {
    const noise = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`cursorAuth/flag${i}`, "x"]));
    const auth = readCursorAuthFromDb(cursorDb({
      ...noise,
      "cursorAuth/refreshToken": "refresh-secret",
      "cursorAuth/v2AccessToken": "\"renamed-token\"",
      "storage.cursorMachineId": "renamed-machine",
      "cursorAuth/primaryEmail": "user@example.com",
    }));
    expect(auth).toEqual({ accessToken: "renamed-token", machineId: "renamed-machine", cachedEmail: "user@example.com" });
  });

  it("prefers the exact keys", () => {
    const auth = readCursorAuthFromDb(cursorDb({
      "cursorAuth/oldAccessToken": "stale",
      "cursorAuth/accessToken": "current",
      "storage.serviceMachineId": "machine",
    }));
    expect(auth).toMatchObject({ accessToken: "current", machineId: "machine" });
  });
});
