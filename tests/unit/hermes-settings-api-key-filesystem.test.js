import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const originalHome = process.env.HOME;

const loadRoute = async (home) => {
  process.env.HOME = home;
  return import(`@/app/api/cli-tools/hermes-settings/route.js?home=${encodeURIComponent(home)}`);
};

afterEach(async () => {
  process.env.HOME = originalHome;
});

describe("Hermes API key filesystem safety", () => {
  it("atomically creates a private .env without leaving secret temp files", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "hermes-settings-"));
    const apiKey = "sk_filesystem_sentinel";

    try {
      const { POST } = await loadRoute(home);
      const response = await POST(new Request("http://localhost/api/cli-tools/hermes-settings", {
        method: "POST",
        body: JSON.stringify({
          baseUrl: "http://localhost:20128",
          apiKey,
          model: "cc/claude-sonnet-4-6",
        }),
      }));

      const hermesDir = path.join(home, ".hermes");
      const envPath = path.join(hermesDir, ".env");
      const envStat = await fs.stat(envPath);
      const dirEntries = await fs.readdir(hermesDir);

      expect(response.status).toBe(200);
      expect(JSON.stringify(await response.json())).not.toContain(apiKey);
      expect(await fs.readFile(envPath, "utf-8")).toBe(`OPENAI_API_KEY=${apiKey}\n`);
      if (process.platform !== "win32") expect(envStat.mode & 0o777).toBe(0o600);
      expect(dirEntries).toEqual([".env", "config.yaml"]);
    } finally {
      await fs.rm(home, { recursive: true, force: true });
    }
  });
});
