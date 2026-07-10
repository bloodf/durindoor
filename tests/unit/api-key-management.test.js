import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { maskApiKeySecret, toApiKeyManagementView } from "../../src/shared/utils/apiKeyManagement.js";

describe("API-key management projection", () => {
  it("keeps identifiers and metadata without serializing the secret", () => {
    const secret = "sk-machine-key-id-checksum";
    const view = toApiKeyManagementView({
      id: "key-1",
      key: secret,
      name: "Production",
      machineId: "machine",
      isActive: true,
      allowedCombos: ["coding"],
      dailyLimitTokens: 100,
      policy: { maxTokens: 1000 },
      expiresAt: "2030-01-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    expect(view).toMatchObject({ id: "key-1", name: "Production", maskedKey: maskApiKeySecret(secret) });
    expect(view).not.toHaveProperty("key");
    expect(JSON.stringify(view)).not.toContain(secret);
  });

  it("does not reveal enough of a legacy key for offline guessing", () => {
    const legacy = "sk-deadbeef";
    const masked = maskApiKeySecret(legacy);
    expect(masked).toBe("sk-••••••••");
    expect(masked).not.toContain("dead");
    expect(masked).not.toContain("beef");
  });

  it("keeps dashboard and CLI management surfaces on masked/manual-secret paths", () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const dashboardRoots = [
      "src/app/(dashboard)/dashboard/cli-tools",
      "src/app/(dashboard)/dashboard/media-providers",
    ];
    const dashboardSource = dashboardRoots.flatMap((root) => {
      const pending = [path.join(repoRoot, root)];
      const files = [];
      while (pending.length) {
        const current = pending.pop();
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
          const child = path.join(current, entry.name);
          if (entry.isDirectory()) pending.push(child);
          else if (/\.[jt]sx?$/.test(entry.name)) files.push(child);
        }
      }
      return files;
    }).map((file) => fs.readFileSync(file, "utf8")).join("\n");

    expect(dashboardSource).not.toMatch(/apiKeys\??\[[^\]]+\]\.key\b/);
    expect(dashboardSource).not.toMatch(/\b(?:key|k)\.key\b/);

    const cliTools = fs.readFileSync(path.join(repoRoot, "cli/src/cli/menus/cliTools.js"), "utf8");
    expect(cliTools).toContain("promptSecret(");
    expect(cliTools).not.toMatch(/await prompt\([^\n]*secret/i);
  });

  it("redacts every CLI status route that returns a raw settings tree", () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    for (const route of [
      "claude-settings",
      "opencode-settings",
      "droid-settings",
      "openclaw-settings",
      "cowork-settings",
      "copilot-settings",
      "deepseek-tui-settings",
    ]) {
      const source = fs.readFileSync(path.join(repoRoot, `src/app/api/cli-tools/${route}/route.js`), "utf8");
      expect(source, `${route} must redact status credentials`).toContain("redactSecrets(");
    }
  });
});
