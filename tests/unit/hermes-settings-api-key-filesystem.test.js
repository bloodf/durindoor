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
  async function withTempHome(fn) {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "hermes-settings-"));
    try {
      await fn(home);
    } finally {
      await fs.rm(home, { recursive: true, force: true });
    }
  }

  it("atomically creates a private .env without leaving secret temp files", async () => {
    await withTempHome(async (home) => {
      const apiKey = "sk_filesystem_sentinel";
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
      const entries = (await fs.readdir(hermesDir)).sort();

      expect(response.status).toBe(200);
      expect(JSON.stringify(await response.json())).not.toContain(apiKey);
      expect(await fs.readFile(envPath, "utf-8")).toBe(`OPENAI_API_KEY=${apiKey}\n`);
      if (process.platform !== "win32") expect(envStat.mode & 0o777).toBe(0o600);
      expect(entries).toEqual([".env", "config.yaml"]);
    });
  });

  it("preserves unrelated entries in the existing .env when updating only OPENAI_API_KEY", async () => {
    await withTempHome(async (home) => {
      const hermesDir = path.join(home, ".hermes");
      const envPath = path.join(hermesDir, ".env");
      await fs.mkdir(hermesDir, { recursive: true, mode: 0o700 });
      await fs.writeFile(envPath, "SIBLING=keepme\nOTHER=value\n", { mode: 0o600 });

      const apiKey = "sk_preserve_sentinel";
      const { POST } = await loadRoute(home);
      const response = await POST(new Request("http://localhost/api/cli-tools/hermes-settings", {
        method: "POST",
        body: JSON.stringify({
          baseUrl: "http://localhost:20128",
          apiKey,
          model: "cc/claude-sonnet-4-6",
        }),
      }));

      expect(response.status).toBe(200);
      const envText = await fs.readFile(envPath, "utf-8");
      expect(envText).toContain("SIBLING=keepme");
      expect(envText).toContain("OTHER=value");
      expect(envText).toContain(`OPENAI_API_KEY=${apiKey}`);
    });
  });

  it("refuses to follow a hostile symlinked .env and leaves the target untouched", async () => {
    if (process.platform === "win32") return;
    await withTempHome(async (home) => {
      const hermesDir = path.join(home, ".hermes");
      await fs.mkdir(hermesDir, { recursive: true, mode: 0o700 });

      const targetPath = path.join(home, "outside.env");
      const targetContents = "SHOULD_NOT_BE_OVERWRITTEN=yes\n";
      await fs.writeFile(targetPath, targetContents, { mode: 0o600 });

      const envPath = path.join(hermesDir, ".env");
      await fs.symlink(targetPath, envPath);

      const apiKey = "sk_symlink_sentinel";
      const { POST } = await loadRoute(home);
      const response = await POST(new Request("http://localhost/api/cli-tools/hermes-settings", {
        method: "POST",
        body: JSON.stringify({
          baseUrl: "http://localhost:20128",
          apiKey,
          model: "cc/claude-sonnet-4-6",
        }),
      }));

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(await fs.readFile(targetPath, "utf-8")).toBe(targetContents);
      expect((await fs.readdir(hermesDir)).includes(".env")).toBe(true);

      const stat = await fs.lstat(envPath);
      expect(stat.isSymbolicLink()).toBe(true);
    });
  });

  it("cleans up the private temp directory and leaves no final .env on forced write/rename failure", async () => {
    if (process.platform === "win32") return;
    await withTempHome(async (home) => {
      const hermesDir = path.join(home, ".hermes");
      await fs.mkdir(hermesDir, { recursive: true, mode: 0o700 });
      const realFs = await import("node:fs");
      const originalRename = realFs.promises.rename;
      const originalWrite = realFs.promises.writeFile;
      let renamed = false;
      realFs.promises.rename = async (src, dst) => {
        if (String(dst).endsWith(".hermes/.env")) {
          renamed = true;
          throw new Error("sk_console_sentinel: forced rename failure");
        }
        return originalRename(src, dst);
      };
      realFs.promises.writeFile = async (target, contents, options) => {
        if (String(target).endsWith(".env") && !String(target).endsWith(".hermes/.env")) {
          // Write to the temp path always succeeds so we exercise the rename failure.
          await fs.mkdir(path.dirname(target), { recursive: true });
          return originalWrite(target, contents, options);
        }
        return originalWrite(target, contents, options);
      };

      try {
        const apiKey = "sk_failure_sentinel";
        const { POST } = await loadRoute(home);
        const response = await POST(new Request("http://localhost/api/cli-tools/hermes-settings", {
          method: "POST",
          body: JSON.stringify({
            baseUrl: "http://localhost:20128",
            apiKey,
            model: "cc/claude-sonnet-4-6",
          }),
        }));

        expect(renamed).toBe(true);
        expect(response.status).toBe(500);
        expect(await fs.stat(envPath).then(() => true, (err) => err.code === "ENOENT")).toBe(true);
        const remaining = await fs.readdir(hermesDir);
        const leftover = remaining.filter((name) => name.startsWith(".env.tmp-"));
        expect(leftover).toEqual([]);
      } finally {
        realFs.promises.rename = originalRename;
        realFs.promises.writeFile = originalWrite;
      }

      const envPath = path.join(hermesDir, ".env");
    });
  });
});
