/**
 * #2309 follow-up: provider registry entries reach the client bundle.
 *
 * src/shared/constants/providers.js imports open-sse/providers/registry/index.js,
 * which imports every registry entry. A Node built-in anywhere under that
 * directory breaks `pnpm run build` with webpack's UnhandledSchemeError.
 *
 * This test locks in two things:
 * (a) no file under open-sse/providers/registry/ imports a Node built-in;
 * (b) the Codex helpers that needed node:crypto still produce the same values
 *     after moving to the server-only open-sse/executors/codex/identity.js.
 */
import fs from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as codexConfig from "../../open-sse/config/codexIdentity.js";
import * as codexRegistry from "../../open-sse/providers/registry/codex.js";
import * as codexServer from "../../open-sse/executors/codex/identity.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const REGISTRY_DIR = path.join(ROOT, "open-sse/providers/registry");

/** Matches every import/export-from/require specifier form. */
const IMPORT_SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+|\bexport\s+\*\s+from\s*)["']([^"'\n]+)["']/g;

const NODE_BUILTINS = new Set(builtinModules.map((name) => name.replace(/^node:/, "")));

function registryFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...registryFiles(full));
    else if (/\.[cm]?js$/.test(entry.name)) files.push(full);
  }
  return files;
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("#2309b: registry entries stay client-safe", () => {
  it("imports no Node built-in from any registry entry", () => {
    const offenders = [];
    for (const file of registryFiles(REGISTRY_DIR)) {
      const source = fs.readFileSync(file, "utf8");
      for (const match of source.matchAll(IMPORT_SPECIFIER)) {
        const specifier = match[1];
        const bare = specifier.replace(/^node:/, "");
        if (specifier.startsWith("node:") || NODE_BUILTINS.has(bare)) {
          offenders.push(`${path.relative(ROOT, file)}: ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the node:crypto-backed Codex helpers out of the registry entry", () => {
    for (const symbol of [
      "deriveStableUUIDv4",
      "createCodexClientIdentity",
      "resolveCodexFingerprintIdentity",
      "withCodexFingerprintCredentials",
    ]) {
      expect(codexRegistry[symbol], symbol).toBeUndefined();
      expect(codexServer[symbol], symbol).toBeTypeOf("function");
      expect(codexConfig[symbol], symbol).toBe(codexServer[symbol]);
    }
  });

  it("still re-exports the client-safe Codex helpers from the registry entry", () => {
    for (const symbol of [
      "CODEX_FINGERPRINT_MODES",
      "CODEX_FINGERPRINT_MODE_KEY",
      "readNamedHeader",
      "accountSeed",
      "isCodexOAuthCredentials",
      "getCodexFingerprintMode",
      "resolveCodexOriginalIdentityHeaders",
      "applyCodexOriginalIdentityHeaders",
      "applyCodexClientIdentityHeaders",
      "applyCodexClientMetadata",
    ]) {
      expect(codexRegistry[symbol], symbol).toBeDefined();
      expect(codexConfig[symbol], symbol).toBe(codexRegistry[symbol]);
    }
  });
});

describe("#2309b: moved Codex helpers keep their values", () => {
  it("derives the same stable UUIDs", () => {
    expect(codexConfig.deriveStableUUIDv4("test")).toBe("9f86d081-884c-4d65-9a2f-eaa0c55ad015");
    expect(codexConfig.deriveStableUUIDv4("")).toBe("e3b0c442-98fc-4c14-9afb-f4c8996fb924");
    expect(codexConfig.deriveStableUUIDv4("durindoor-codex-installation:default")).toBe(
      "6f3e156a-eae7-481e-9138-85eec1bfc9a9"
    );
  });

  it("builds the same converged identity", () => {
    const identity = codexConfig.createCodexClientIdentity(
      "client-session",
      { workspaceId: "workspace-a" },
      { accountKey: "acct-1" }
    );
    expect(identity.mode).toBe("session");
    expect(identity.installationId).toBe("c7e47fff-6592-4f62-b1fc-d66c76d31727");
    expect(identity.sessionId).toBe("ba446f93-8f87-4358-9e92-856dbdb939a1");
    expect(identity.threadId).toBe("1b9e8cf7-dc84-491a-a9b6-d99f77a082e6");
    expect(identity.windowId).toBe("1b9e8cf7-dc84-491a-a9b6-d99f77a082e6:0");
    expect(identity.turnId).toMatch(UUID_V4);
  });

  it("keeps the device-mode identity empty", () => {
    const identity = codexConfig.createCodexClientIdentity("cs", {}, { mode: "device", accountKey: "acct-1" });
    expect(identity.mode).toBe("device");
    expect(identity.installationId).toBe("c7e47fff-6592-4f62-b1fc-d66c76d31727");
    expect(identity.sessionId).toBe("");
    expect(identity.threadId).toBe("");
    expect(identity.turnId).toBe("");
    expect(identity.windowId).toBe("");
  });

  it("keeps the fingerprint mode resolution", () => {
    expect(codexConfig.getCodexFingerprintMode({}, true)).toBe("session");
    expect(codexConfig.getCodexFingerprintMode({ codexFingerprintMode: "off" }, true)).toBe("off");
    expect(codexConfig.getCodexFingerprintMode({ codexFingerprintMode: "full" }, true)).toBe("full");
    expect(codexConfig.getCodexFingerprintMode({}, false)).toBe("off");
  });

  it("keeps the account seed resolution", () => {
    expect(codexConfig.accountSeed({ email: "a@b.c" }, null)).toBe("a@b.c");
    expect(codexConfig.accountSeed({}, "key")).toBe("key");
    expect(codexConfig.accountSeed({}, null)).toBe("default");
  });

  it("keeps the header read behaviour", () => {
    expect(codexConfig.readNamedHeader({ "Session-ID": " abc " }, "session-id")).toBe("abc");
    expect(codexConfig.readNamedHeader(null, "session-id")).toBe("");
  });

  it("keeps the resolved fingerprint identity", () => {
    const identity = codexConfig.resolveCodexFingerprintIdentity({
      credentials: {
        accessToken: "token",
        providerSpecificData: { workspaceId: "workspace-a" },
        connectionId: "acct-1",
      },
      clientHeaders: { "session-id": "cs-1" },
    });
    expect(identity.mode).toBe("session");
    expect(identity.installationId).toBe("c7e47fff-6592-4f62-b1fc-d66c76d31727");
    expect(identity.sessionId).toBe("ba446f93-8f87-4358-9e92-856dbdb939a1");
    expect(identity.threadId).toBe("c9cb38ac-a3a3-4845-b621-7b12c2f87717");
    expect(identity.windowId).toBe("c9cb38ac-a3a3-4845-b621-7b12c2f87717:0");
  });

  it("keeps merging the identity into request credentials", () => {
    const credentials = codexConfig.withCodexFingerprintCredentials(
      {
        accessToken: "token",
        providerSpecificData: { workspaceId: "workspace-a", codexClientIdentity: { stale: true } },
        connectionId: "acct-1",
      },
      { "session-id": "cs-1" }
    );
    expect(credentials.providerSpecificData.workspaceId).toBe("workspace-a");
    expect(credentials.providerSpecificData.codexClientIdentity.stale).toBeUndefined();
    expect(credentials.providerSpecificData.codexClientIdentity.installationId).toBe(
      "c7e47fff-6592-4f62-b1fc-d66c76d31727"
    );
  });

  it("keeps applying the identity onto headers and body metadata", () => {
    const identity = codexConfig.resolveCodexFingerprintIdentity({
      credentials: {
        accessToken: "token",
        providerSpecificData: { workspaceId: "workspace-a" },
        connectionId: "acct-1",
      },
      clientHeaders: { "session-id": "cs-1" },
    });

    const headers = codexConfig.applyCodexClientIdentityHeaders({ "x-old": "1" }, identity);
    expect(headers["x-codex-installation-id"]).toBe("c7e47fff-6592-4f62-b1fc-d66c76d31727");
    expect(headers["session-id"]).toBe("ba446f93-8f87-4358-9e92-856dbdb939a1");
    expect(headers["thread-id"]).toBe("c9cb38ac-a3a3-4845-b621-7b12c2f87717");
    expect(headers["x-codex-window-id"]).toBe("c9cb38ac-a3a3-4845-b621-7b12c2f87717:0");
    expect(JSON.parse(headers["x-codex-turn-metadata"])).toMatchObject({
      thread_source: "user",
      sandbox: "none",
      installation_id: "c7e47fff-6592-4f62-b1fc-d66c76d31727",
      session_id: "ba446f93-8f87-4358-9e92-856dbdb939a1",
      thread_id: "c9cb38ac-a3a3-4845-b621-7b12c2f87717",
    });

    const body = codexConfig.applyCodexClientMetadata({}, identity);
    expect(body.client_metadata["x-codex-installation-id"]).toBe("c7e47fff-6592-4f62-b1fc-d66c76d31727");
    expect(body.client_metadata.session_id).toBe("ba446f93-8f87-4358-9e92-856dbdb939a1");
    expect(body.client_metadata.thread_id).toBe("c9cb38ac-a3a3-4845-b621-7b12c2f87717");
    expect(body.client_metadata.turn_id).toBe(identity.turnId);
  });
});
