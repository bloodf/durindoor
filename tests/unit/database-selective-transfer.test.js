import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// NOTE: `src/lib/db/driver.js` caches its adapter on `global._dbAdapter` and
// captures that object in a module-scope `const state` at import time. A
// single static top-level import of the DB module graph would therefore
// reuse one cached SQLite adapter across every test's own temp DATA_DIR.
// Every test below gets its own module graph via `vi.resetModules()` +
// dynamic import after pointing DATA_DIR at a fresh temp directory, so each
// test opens (and closes) its own on-disk database.

const routeMocks = vi.hoisted(() => ({
  auth: vi.fn(async () => false),
  body: vi.fn(async () => ({})),
}));

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-selective-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
  routeMocks.auth.mockReset().mockImplementation(async () => false);
  routeMocks.body.mockReset().mockImplementation(async () => ({}));
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

/** Fresh module graph bound to the current DATA_DIR/global._dbAdapter. */
async function freshDb() {
  const index = await import("../../src/lib/db/index.js");
  const driver = await import("../../src/lib/db/driver.js");
  const repos = await import("../../src/lib/db/repos/connectionsRepo.js");
  const combos = await import("../../src/lib/db/repos/combosRepo.js");
  const crypto = await import("../../src/lib/crypto/columnCrypto.js");
  return { index, driver, repos, combos, crypto };
}

/** Fresh selective-transfer route bound to the same module graph, with the
 * parent database route's auth/body helpers mocked. */
async function freshRoute() {
  vi.doMock("../../src/app/api/settings/database/route.js", () => ({
    DATABASE_IMPORT_MAX_BYTES: 32,
    readJsonBodyWithLimit: routeMocks.body,
    requireDatabaseDualAuth: routeMocks.auth,
  }));
  const mod = await import("../../src/app/api/settings/database/selective/route.js");
  return mod.POST;
}

function selection(providers = [], combos = []) { return { providers, combos }; }

function buildBundle({ providers = [], combos = [] } = {}) {
  return {
    format: "durindoor-selective-transfer",
    version: 1,
    providerConnections: providers,
    combos,
  };
}

describe("selective transfer: real DB round-trip", () => {
  it("exposes only safe metadata on a non-secret export (no top-level secrets, no PSD secrets, no credentialed URLs)", async () => {
    const { index, repos } = await freshDb();
    await repos.createProviderConnection({
      provider: "openai",
      authType: "apikey",
      name: "safe-export",
      apiKey: "sk-leak-me",
      providerSpecificData: {
        baseUrl: "http://user:hunter2@api.example.com/v1",
        githubLogin: "octocat",
        // PSD credential-like fields must NEVER appear even in explicit-secret mode
        // because PSD has no at-rest crypto on this fork.
        clientSecret: "oauth-secret",
        copilotToken: "ghu_xyz",
        idToken: "jwt.id.token",
        cookie: "session=abc",
        // Non-scalar smuggling attempt must be rejected outright.
        proxyUrl: { refresh_token: "nested-attack" },
      },
    });
    const all = await repos.getProviderConnections();
    const id = all[0].id;
    const bundle = await index.exportSelectiveDb(selection([id]));
    expect(bundle.providerConnections).toHaveLength(1);
    const out = bundle.providerConnections[0];
    expect(out.apiKey).toBeUndefined();
    expect(out.accessToken).toBeUndefined();
    expect(out.refreshToken).toBeUndefined();
    expect(out.idToken).toBeUndefined();
    expect(out.firecrawlHeaders).toBeUndefined();
    const psd = out.providerSpecificData;
    expect(psd.baseUrl).toBeUndefined();
    expect(psd.clientSecret).toBeUndefined();
    expect(psd.copilotToken).toBeUndefined();
    expect(psd.idToken).toBeUndefined();
    expect(psd.cookie).toBeUndefined();
    expect(psd.proxyUrl).toBeUndefined();
    expect(psd.githubLogin).toBe("octocat");
  });

  it("safe export omits a real connectionProxyUrl credential (http://user:pass@proxy) even though the field name is not proxy-labeled in the URL itself", async () => {
    const { index, repos } = await freshDb();
    await repos.createProviderConnection({
      provider: "openai",
      authType: "apikey",
      name: "proxy-creds",
      apiKey: "sk-x",
      providerSpecificData: {
        connectionProxyUrl: "http://proxyuser:proxypass@10.0.0.5:8080",
        connectionProxyEnabled: true,
        githubLogin: "kept",
      },
    });
    const id = (await repos.getProviderConnections())[0].id;
    const safe = await index.exportSelectiveDb(selection([id]));
    const psd = safe.providerConnections[0].providerSpecificData;
    expect(psd.connectionProxyUrl).toBeUndefined();
    expect(JSON.stringify(psd)).not.toContain("proxyuser");
    expect(JSON.stringify(psd)).not.toContain("proxypass");
    // Non-credential proxy toggle metadata survives.
    expect(psd.connectionProxyEnabled).toBe(true);
    // Explicit opt-in export also never includes it — the fork's crypto
    // covers top-level fields only, not PSD.
    const withSecrets = await index.exportSelectiveDb(selection([id]), { includeSecrets: true });
    expect(withSecrets.providerConnections[0].providerSpecificData.connectionProxyUrl).toBeUndefined();
  });

  it("import merge preserves an existing nested PSD credential branch the bundle never mentions", async () => {
    const { index, repos, driver } = await freshDb();
    await repos.createProviderConnection({
      provider: "openai",
      authType: "oauth",
      name: "nested-merge",
      accessToken: "at-x",
      providerSpecificData: { githubLogin: "octocat" },
    });
    const id = (await repos.getProviderConnections())[0].id;
    // Real production connections can carry nested objects inside PSD (e.g. a
    // vendor SDK's own token cache) that the transfer schema never describes.
    // Write one directly at the storage layer to prove the merge helper
    // preserves a whole nested branch the bundle omits, not just flat keys.
    const db = await driver.getAdapter();
    const row = db.get("SELECT data FROM providerConnections WHERE id = ?", [id]);
    const stored = JSON.parse(row.data);
    stored.providerSpecificData.oauthCache = { refreshToken: "nested-secret-branch", issuedAt: "2026-01-01" };
    db.run("UPDATE providerConnections SET data = ? WHERE id = ?", [JSON.stringify(stored), id]);

    await index.importSelectiveDb(buildBundle({
      providers: [{ id, provider: "openai", authType: "oauth", name: "nested-merge", providerSpecificData: { baseUrl: "https://api.example/v2" } }],
    }), selection([id]));

    const afterRow = db.get("SELECT data FROM providerConnections WHERE id = ?", [id]);
    const afterData = JSON.parse(afterRow.data);
    expect(afterData.providerSpecificData.oauthCache).toEqual({ refreshToken: "nested-secret-branch", issuedAt: "2026-01-01" });
    expect(afterData.providerSpecificData.githubLogin).toBe("octocat");
    expect(afterData.providerSpecificData.baseUrl).toBe("https://api.example/v2");
  });

  it("export with includeSecrets only emits documented top-level credentials and never PSD secret-like fields", async () => {
    const { index, repos } = await freshDb();
    await repos.createProviderConnection({
      provider: "anthropic",
      authType: "oauth",
      name: "explicit-secrets",
      accessToken: "at-explicit",
      refreshToken: "rt-explicit",
      idToken: "id-explicit",
      apiKey: "sk-explicit",
      providerSpecificData: { clientSecret: "must-not-leak", githubLogin: "alice" },
    });
    const id = (await repos.getProviderConnections())[0].id;
    const bundle = await index.exportSelectiveDb(selection([id]), { includeSecrets: true });
    const out = bundle.providerConnections[0];
    expect(out.accessToken).toBe("at-explicit");
    expect(out.refreshToken).toBe("rt-explicit");
    expect(out.idToken).toBe("id-explicit");
    expect(out.apiKey).toBe("sk-explicit");
    expect(out.providerSpecificData.clientSecret).toBeUndefined();
    expect(out.providerSpecificData.githubLogin).toBe("alice");
  });

  it("preview always projects secrets out, regardless of includeSecrets or credentialed URLs in PSD", async () => {
    const { index, repos } = await freshDb();
    await repos.createProviderConnection({
      provider: "openai",
      authType: "apikey",
      name: "preview",
      apiKey: "sk-should-not-show",
      providerSpecificData: { baseUrl: "https://host.example/x" },
    });
    const id = (await repos.getProviderConnections())[0].id;
    const bundle = await index.exportSelectiveDb(selection([id]), { includeSecrets: true });
    const preview = await index.previewSelectiveImport(bundle, selection([id]));
    expect(preview.secretsIncluded).toBe(false);
    expect(preview.providerConnections).toHaveLength(1);
    expect(preview.providerConnections[0].action).toBe("merge");
  });

  it("rejects a bundle row whose PSD smuggles a non-scalar credentialed value", async () => {
    const { index, repos } = await freshDb();
    await repos.createProviderConnection({ provider: "openai", authType: "apikey", name: "seed", apiKey: "sk-seed" });
    const id = (await repos.getProviderConnections())[0].id;
    await expect(
      index.importSelectiveDb(buildBundle({
        providers: [{ id, provider: "openai", authType: "apikey", name: "seed", providerSpecificData: { baseUrl: { refresh_token: "leak" } } }],
      }), selection([id]))
    ).rejects.toThrow(/unsupported field|providerSpecificData/);
  });

  it("rejects a bundle row whose PSD carries a credentialed URL or a secret-like key (refresh_token, proxyPassword)", async () => {
    const { index, repos } = await freshDb();
    await repos.createProviderConnection({ provider: "openai", authType: "apikey", name: "seed", apiKey: "sk-seed" });
    const id = (await repos.getProviderConnections())[0].id;
    await expect(
      index.importSelectiveDb(buildBundle({
        providers: [{ id, provider: "openai", authType: "apikey", name: "seed", providerSpecificData: { baseUrl: "http://user:pass@api.example/v1" } }],
      }), selection([id]))
    ).rejects.toThrow(/unsupported field|providerSpecificData/);
    await expect(
      index.importSelectiveDb(buildBundle({
        providers: [{ id, provider: "openai", authType: "apikey", name: "seed", providerSpecificData: { refresh_token: "leak" } }],
      }), selection([id]))
    ).rejects.toThrow(/unsupported field|providerSpecificData/);
    await expect(
      index.importSelectiveDb(buildBundle({
        providers: [{ id, provider: "openai", authType: "apikey", name: "seed", providerSpecificData: { proxyPassword: "leak" } }],
      }), selection([id]))
    ).rejects.toThrow(/unsupported field|providerSpecificData/);
  });

  it("import preserves existing nested credentials when bundle omits them and merges missing keys back from existing PSD", async () => {
    const { index, repos } = await freshDb();
    await repos.createProviderConnection({
      provider: "openai",
      authType: "oauth",
      name: "merge-me",
      accessToken: "at-local",
      refreshToken: "rt-local",
      idToken: "id-local",
      providerSpecificData: { githubLogin: "octocat", accountId: "acc-1", codexFingerprintMode: "device" },
    });
    const id = (await repos.getProviderConnections())[0].id;
    const localBefore = await repos.getProviderConnectionById(id);
    expect(localBefore.providerSpecificData.githubLogin).toBe("octocat");
    const result = await index.importSelectiveDb(buildBundle({
      providers: [{ id, provider: "openai", authType: "oauth", name: "merge-me", providerSpecificData: { baseUrl: "https://api.example/v1" } }],
    }), selection([id]));
    expect(result.imported.providers).toEqual([id]);
    const localAfter = await repos.getProviderConnectionById(id);
    expect(localAfter.accessToken).toBe("at-local");
    expect(localAfter.refreshToken).toBe("rt-local");
    expect(localAfter.idToken).toBe("id-local");
    expect(localAfter.providerSpecificData.githubLogin).toBe("octocat");
    expect(localAfter.providerSpecificData.accountId).toBe("acc-1");
    expect(localAfter.providerSpecificData.codexFingerprintMode).toBe("device");
    expect(localAfter.providerSpecificData.baseUrl).toBe("https://api.example/v1");
  });

  it("rolls back a provider write when a later combo INSERT aborts inside the import transaction", async () => {
    const { index, repos, combos, driver } = await freshDb();
    const db = await driver.getAdapter();
    // Fails only after the provider loop has written. This proves actual
    // transaction rollback, rather than earlier projection-phase rejection.
    db.exec(`CREATE TRIGGER fail_selective_combo BEFORE INSERT ON combos
      WHEN NEW.id = 'later-failure'
      BEGIN SELECT RAISE(ABORT, 'forced later failure'); END;`);
    const importedProviderId = "provider-written-first";
    await expect(
      index.importSelectiveDb(buildBundle({
        providers: [{ id: importedProviderId, provider: "openai", authType: "apikey", name: "must-rollback", apiKey: "sk-never-persist" }],
        combos: [{ id: "later-failure", name: "later-combo", kind: "test", models: [{ provider: "openai", model: "gpt-5" }] }],
      }), selection([importedProviderId], ["later-failure"]))
    ).rejects.toThrow(/forced later failure/);
    expect(await repos.getProviderConnectionById(importedProviderId)).toBeNull();
    expect(await combos.getComboById("later-failure")).toBeNull();
  });

  it("round-trips selective weights, canonicalizes legacy members, and preserves omitted unchanged weights", async () => {
    const { index, combos } = await freshDb();
    const weighted = await combos.createCombo({
      name: "selective-weighted",
      models: ["openai/gpt-5", "anthropic/claude"],
      members: [{ id: "openai/gpt-5", weight: 7 }, { id: "anthropic/claude", weight: 0.5 }],
    });
    const bundle = await index.exportSelectiveDb(selection([], [weighted.id]));
    expect(bundle.combos[0].members).toEqual(weighted.members);

    await combos.updateCombo(weighted.id, { members: [{ id: "openai/gpt-5", weight: 1 }, { id: "anthropic/claude", weight: 1 }] });
    await index.importSelectiveDb(bundle, selection([], [weighted.id]));
    expect((await combos.getComboById(weighted.id)).members).toEqual(weighted.members);

    const legacy = { ...bundle.combos[0], members: null };
    legacy.id = "legacy-selective";
    legacy.name = "legacy-selective";
    await index.importSelectiveDb(buildBundle({ combos: [legacy] }), selection([], [legacy.id]));
    expect((await combos.getComboById(legacy.id)).members).toEqual([
      { id: "openai/gpt-5", weight: 1 },
      { id: "anthropic/claude", weight: 1 },
    ]);

    const omittedMembers = { ...bundle.combos[0] };
    delete omittedMembers.members;
    await index.importSelectiveDb(buildBundle({ combos: [omittedMembers] }), selection([], [weighted.id]));
    expect((await combos.getComboById(weighted.id)).members).toEqual(weighted.members);
  });

  it("rejects malformed selective members before provider writes", async () => {
    const { index, repos, combos } = await freshDb();
    const providerId = "must-not-write";
    await expect(index.importSelectiveDb(buildBundle({
      providers: [{ id: providerId, provider: "openai", authType: "apikey", name: "must-not-write" }],
      combos: [{ id: "bad-members", name: "bad-members", models: ["openai/gpt-5"], members: [{ id: "other/model", weight: Infinity }] }],
    }), selection([providerId], ["bad-members"]))).rejects.toThrow(/positive finite|match models/);
    expect(await repos.getProviderConnectionById(providerId)).toBeNull();
    expect(await combos.getComboById("bad-members")).toBeNull();
  });

  it("leaves unrelated providers and unrelated combos untouched across a real import", async () => {
    const { index, repos, combos } = await freshDb();
    await repos.createProviderConnection({ provider: "openai", authType: "apikey", name: "kept-1", apiKey: "sk-kept-1" });
    await repos.createProviderConnection({ provider: "anthropic", authType: "apikey", name: "imported-1", apiKey: "sk-import" });
    const allConns = await repos.getProviderConnections();
    const kept = allConns.find((c) => c.name === "kept-1");
    const imported = allConns.find((c) => c.name === "imported-1");
    await combos.createCombo({ name: "kept-combo", kind: "test", models: ["openai/gpt-5"] });
    const keptCombo = (await combos.getCombos())[0];
    const result = await index.importSelectiveDb(buildBundle({
      providers: [{ id: imported.id, provider: "anthropic", authType: "apikey", name: "imported-1-renamed", email: "new@example.com" }],
    }), selection([imported.id]));
    expect(result.imported.providers).toEqual([imported.id]);
    const stillKept = await repos.getProviderConnectionById(kept.id);
    expect(stillKept.name).toBe("kept-1");
    expect(stillKept.apiKey).toBe("sk-kept-1");
    const stillCombo = await combos.getComboById(keptCombo.id);
    expect(stillCombo.name).toBe("kept-combo");
  });

  it("explicit opt-in import with plaintext credentials encrypts top-level fields and rejects encrypted blobs (cross-DATA_DIR AAD)", async () => {
    const { index, repos, driver, crypto } = await freshDb();
    await repos.createProviderConnection({ provider: "openai", authType: "oauth", name: "target", accessToken: "old-at" });
    const id = (await repos.getProviderConnections())[0].id;
    const encryptedBlob = { v: 1, iv: "AA==", ct: "BB==" };
    await expect(
      index.importSelectiveDb(buildBundle({
        providers: [{ id, provider: "openai", authType: "oauth", name: "target", accessToken: encryptedBlob }],
      }), selection([id]))
    ).rejects.toThrow(/encrypted credential blob/);
    await index.importSelectiveDb(buildBundle({
      providers: [{ id, provider: "openai", authType: "oauth", name: "target", accessToken: "new-at-plaintext" }],
    }), selection([id]));
    const stored = await repos.getProviderConnectionById(id);
    expect(stored.accessToken).toBe("new-at-plaintext");
    const db = await driver.getAdapter();
    const row = db.get("SELECT data FROM providerConnections WHERE id = ?", [id]);
    const parsed = JSON.parse(row.data);
    expect(crypto.isEncryptedBlob(parsed.accessToken)).toBe(true);
  });

  it("round-trips combo capability ceilings without corrupting invariant fields", async () => {
    const { index, combos } = await freshDb();
    await combos.createCombo({
      name: "bounded-combo",
      kind: "test",
      models: ["openai/gpt-5"],
      invariant: { allowedProviders: ["openai"] },
      capabilities: { vision: false, tools: false, contextWindow: 32_768, maxOutput: 4_096 },
    });
    const original = (await combos.getCombos())[0];
    const bundle = await index.exportSelectiveDb(selection([], [original.id]));
    expect(bundle.combos[0]).toMatchObject({
      id: original.id,
      invariant: { allowedProviders: ["openai"], allowedModelFamilies: [] },
      capabilities: { vision: false, tools: false, contextWindow: 32_768, maxOutput: 4_096 },
    });

    await combos.deleteCombo(original.id);
    await index.importSelectiveDb(bundle, selection([], [original.id]));
    expect(await combos.getComboById(original.id)).toMatchObject({
      invariant: { allowedProviders: ["openai"], allowedModelFamilies: [] },
      capabilities: { vision: false, tools: false, contextWindow: 32_768, maxOutput: 4_096 },
    });
  });

  it("preserves an existing capability ceiling when omitted and clears it only on explicit null", async () => {
    const { index, combos } = await freshDb();
    await combos.createCombo({
      name: "existing-cap",
      kind: "test",
      models: ["openai/gpt-5"],
      capabilities: { contextWindow: 16_384, maxOutput: 2_048 },
    });
    const original = (await combos.getCombos())[0];
    const baseRow = { id: original.id, name: original.name, kind: original.kind, models: original.models };

    await index.importSelectiveDb(buildBundle({ combos: [baseRow] }), selection([], [original.id]));
    expect((await combos.getComboById(original.id)).capabilities).toEqual({ contextWindow: 16_384, maxOutput: 2_048 });

    await index.importSelectiveDb(buildBundle({ combos: [{ ...baseRow, capabilities: null }] }), selection([], [original.id]));
    expect((await combos.getComboById(original.id)).capabilities).toBeNull();
  });

  it("rejects an invalid capability ceiling before any import write", async () => {
    const { index, repos, combos } = await freshDb();
    await combos.createCombo({
      name: "safe-cap",
      kind: "test",
      models: ["openai/gpt-5"],
      capabilities: { contextWindow: 8_192 },
    });
    const existing = (await combos.getCombos())[0];
    const providerId = "must-not-write";

    await expect(index.importSelectiveDb(buildBundle({
      providers: [{ id: providerId, provider: "openai", authType: "apikey", name: "rolled-back" }],
      combos: [{ id: existing.id, name: existing.name, kind: existing.kind, models: existing.models, capabilities: { contextWindow: 0 } }],
    }), selection([providerId], [existing.id]))).rejects.toThrow(/contextWindow must be a positive integer/);

    expect(await repos.getProviderConnectionById(providerId)).toBeNull();
    expect((await combos.getComboById(existing.id)).capabilities).toEqual({ contextWindow: 8_192 });
  });

  it("validateComboInvariant runs before the write: a violating combo bundle is rejected and never persisted", async () => {
    const { index, repos, combos } = await freshDb();
    await repos.createProviderConnection({ provider: "openai", authType: "apikey", name: "p", apiKey: "sk-x" });
    await expect(
      index.importSelectiveDb(buildBundle({
        combos: [{ id: "violating", name: "violator", kind: "test", models: [{ provider: "openai", model: "gpt-5" }], invariant: { allowedProviders: ["anthropic"] } }],
      }), selection([], ["violating"]))
    ).rejects.toThrow(/violates its invariant|ComboInvariantError/);
    const all = await combos.getCombos();
    expect(all.find((c) => c.id === "violating")).toBeUndefined();
  });

  it("catalog returns ids+names only and never includes credentials or providerSpecificData", async () => {
    const { index, repos } = await freshDb();
    await repos.createProviderConnection({ provider: "openai", authType: "oauth", name: "ops", accessToken: "do-not-leak", apiKey: "do-not-leak", providerSpecificData: { baseUrl: "https://x" } });
    const cat = await index.getSelectiveTransferCatalog();
    expect(cat.providers).toHaveLength(1);
    const row = cat.providers[0];
    expect(Object.keys(row).sort()).toEqual(["id", "name"]);
    expect(row.accessToken).toBeUndefined();
    expect(row.apiKey).toBeUndefined();
    expect(row.providerSpecificData).toBeUndefined();
  });
});

describe("selective transfer route: dual-auth + body-limit + secret opt-in (route layer)", () => {
  function requestFor() {
    return new Request("http://localhost/api/settings/database/selective", { method: "POST" });
  }

  function body(action, extra = {}) {
    return { action, password: "password", selection: { providers: [], combos: [] }, ...extra };
  }

  it("rejects password-only access for every action", async () => {
    const POST = await freshRoute();
    for (const action of ["catalog", "preview", "export", "apply"]) {
      routeMocks.auth.mockResolvedValueOnce(false);
      routeMocks.body.mockResolvedValueOnce(body(action));
      expect((await POST(requestFor())).status).toBe(401);
    }
  });

  it("allows each action when dual auth returns true", async () => {
    const POST = await freshRoute();
    for (const action of ["catalog", "preview", "export", "apply"]) {
      routeMocks.auth.mockResolvedValueOnce(true);
      routeMocks.body.mockResolvedValueOnce(
        body(action, action === "apply" ? { bundle: buildBundle() } : {})
      );
      expect((await POST(requestFor())).status).toBe(200);
    }
  });

  it("bounds all actions before authentication on oversized bodies", async () => {
    const POST = await freshRoute();
    for (const action of ["catalog", "preview", "export", "apply"]) {
      routeMocks.body.mockRejectedValueOnce(Object.assign(new Error("large"), { code: "DATABASE_IMPORT_TOO_LARGE" }));
      expect((await POST(requestFor())).status).toBe(413);
    }
  });

  it("preview always projects secrets out despite an includeSecrets flag in the body", async () => {
    const POST = await freshRoute();
    routeMocks.auth.mockResolvedValueOnce(true);
    routeMocks.body.mockResolvedValueOnce(body("preview", { includeSecrets: true }));
    const response = await POST(requestFor());
    const data = await response.json();
    expect(data.secretsIncluded).toBe(false);
  });

  it("requires the distinct acknowledgeSecretExport flag before exporting credentials", async () => {
    const POST = await freshRoute();
    routeMocks.auth.mockResolvedValueOnce(true);
    routeMocks.body.mockResolvedValueOnce(body("export", { includeSecrets: true, acknowledgeSecretExport: false }));
    expect((await POST(requestFor())).status).toBe(400);
  });

  it("a preview request with an inline bundle never applies it (no rows imported)", async () => {
    const POST = await freshRoute();
    routeMocks.auth.mockResolvedValueOnce(true);
    routeMocks.body.mockResolvedValueOnce({
      action: "preview",
      password: "p",
      bundle: buildBundle({ providers: [], combos: [] }),
    });
    const response = await POST(requestFor());
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.secretsIncluded).toBe(false);
    expect(data.providerConnections).toEqual([]);
  });
});
