// Claude personal and Team accounts can share one email (a user can be a
// member of a Team org under the same login). createProviderConnection used
// to dedup Claude OAuth rows on email alone, so connecting a Team account
// after a personal one silently overwrote the personal connection's tokens.
// Port of OmniRoute e7a65d28d (#12222): require organizationUUID equality
// when both sides have it; fall back to bare-email when either lacks it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-conn-claude-org-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

async function freshRepo() {
  return import("../../src/lib/db/repos/connectionsRepo.js");
}

describe("Claude OAuth connection dedup by organizationUUID", () => {
  it("keeps personal and Team accounts under the same email as separate connections", async () => {
    const repo = await freshRepo();
    const personal = await repo.createProviderConnection({
      provider: "claude",
      authType: "oauth",
      email: "dev@example.com",
      accessToken: "AT-personal",
      providerSpecificData: { claudeOrgUuid: "org-personal" },
    });
    const team = await repo.createProviderConnection({
      provider: "claude",
      authType: "oauth",
      email: "dev@example.com",
      accessToken: "AT-team",
      providerSpecificData: { claudeOrgUuid: "org-team" },
    });

    expect(team.id).not.toBe(personal.id);
    const all = await repo.getProviderConnections({ provider: "claude" });
    expect(all).toHaveLength(2);
    const reloadedPersonal = await repo.getProviderConnectionById(personal.id);
    expect(reloadedPersonal.accessToken).toBe("AT-personal");
  });

  it("still collapses onto the same connection when the org uuid repeats", async () => {
    const repo = await freshRepo();
    const first = await repo.createProviderConnection({
      provider: "claude",
      authType: "oauth",
      email: "dev@example.com",
      accessToken: "AT-1",
      providerSpecificData: { claudeOrgUuid: "org-team" },
    });
    const second = await repo.createProviderConnection({
      provider: "claude",
      authType: "oauth",
      email: "dev@example.com",
      accessToken: "AT-2",
      providerSpecificData: { claudeOrgUuid: "org-team" },
    });

    expect(second.id).toBe(first.id);
    const all = await repo.getProviderConnections({ provider: "claude" });
    expect(all).toHaveLength(1);
    expect(all[0].accessToken).toBe("AT-2");
  });

  it("falls back to bare-email match when either side lacks an org uuid", async () => {
    const repo = await freshRepo();
    const noOrg = await repo.createProviderConnection({
      provider: "claude",
      authType: "oauth",
      email: "dev@example.com",
      accessToken: "AT-1",
    });
    const reconnect = await repo.createProviderConnection({
      provider: "claude",
      authType: "oauth",
      email: "dev@example.com",
      accessToken: "AT-2",
      providerSpecificData: { claudeOrgUuid: "org-team" },
    });

    expect(reconnect.id).toBe(noOrg.id);
    const all = await repo.getProviderConnections({ provider: "claude" });
    expect(all).toHaveLength(1);
    expect(all[0].accessToken).toBe("AT-2");
  });
});
