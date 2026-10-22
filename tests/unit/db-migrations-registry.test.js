import { describe, expect, it } from "vitest";
import { MIGRATIONS } from "../../src/lib/db/migrations/index.js";
describe("db migrations registry", () => {
  it("has no duplicate migration versions", () => {
    const versions = MIGRATIONS.map((m) => m.version);
    expect(new Set(versions).size).toBe(versions.length);
  });
});
