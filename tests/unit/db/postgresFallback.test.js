import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openActiveAdapter } from "@/lib/db/postgresFallback.js";
import normalizeEnv from "../../../src/shared/utils/normalizeEnv.js";

let dataDir;
afterEach(() => {
  vi.unstubAllEnvs();
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("explicit PostgreSQL-only boot", () => {
  it.each([undefined, ""])("rejects a missing connection URL after environment normalization (%s)", async (url) => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-pg-only-"));
    const env = normalizeEnv.normalizeProcessEnv({
      DURINDOOR_DATABASE_ENGINE: "postgres",
      ...(url !== undefined ? { DURINDOOR_PG_URL: url } : {}),
    });
    vi.stubEnv("DATA_DIR", dataDir);
    vi.stubEnv("DURINDOOR_DATABASE_ENGINE", env.DURINDOOR_DATABASE_ENGINE);
    vi.stubEnv("DURINDOOR_PG_URL", env.DURINDOOR_PG_URL);

    await expect(openActiveAdapter()).rejects.toThrow("[DB][pg] url is required");
    expect(fs.readdirSync(dataDir)).toEqual([]);
  });
});
