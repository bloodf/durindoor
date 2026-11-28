import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { pickSafeProviderSpecificData } from "../../src/lib/providerRouteHandlers.js";
import { mergeProviderSpecificData } from "../../src/lib/db/helpers/mergeProviderMetadata.js";

const mocks = vi.hoisted(() => ({ existing: null, update: vi.fn() }));
vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: async () => mocks.existing,
  updateProviderConnection: mocks.update,
  getProviderConnections: vi.fn(), getProviderNodes: vi.fn(), getProviderNodeById: vi.fn(),
  getProxyPoolById: vi.fn(), createProviderConnection: vi.fn(), deleteProviderConnection: vi.fn(),
}));
const { PUT } = await import("../../src/app/api/providers/[id]/route.js");

const root = resolve(import.meta.dirname, "../..");
const credentialName = /token|secret|cookie|password|passwd|credential|api[-_]?key|authorization|passkey|uuid|jwt|storageState/i;
// These credential-shaped names are settings or expiration metadata, not credentials.
const nonSecrets = {
  copilotTokenExpiresAt: "expiration timestamp",
};
const credentialReads = [
  "cookie", "copilotToken", "extraApiKeys", "firebaseRefreshToken", "jwt",
  "mimoPassToken", "recaptchaV3Token", "refreshToken", "refresh_token",
  "sessionToken", "storageState", "turnstileToken", "userToken",
  // Z.ai Web Local Storage session token (open-sse/executors/zai-web/session.js, #2034).
  "token",
];

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith(".js") ? [path] : [];
  });
}

describe("provider metadata credentials", () => {
  it("hides session values while preserving them in an update that omits them", () => {
    const stored = { jwt: "jwt-value", storageState: { cookies: ["session"] }, workspaceId: "workspace" };
    const visible = pickSafeProviderSpecificData("chatplayground", stored);
    expect(visible).toEqual({ workspaceId: "workspace" });
    expect(mergeProviderSpecificData(stored, visible)).toEqual(stored);
    expect(pickSafeProviderSpecificData("x", { customJwt: "secret" })).toEqual({});
  });

  it("preserves omitted and masked credentials during an update while accepting replacements", async () => {
    const stored = { jwt: "old-jwt", storageState: { cookies: ["old"] }, cookie: "old-cookie", workspaceId: "old" };
    mocks.existing = { id: "connection", provider: "chatplayground", providerSpecificData: stored };
    mocks.update.mockImplementation(async (_id, patch) => ({ ...mocks.existing, ...patch }));
    const update = async (providerSpecificData) => PUT(new Request("http://localhost/api/providers/connection", {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ providerSpecificData }),
    }), { params: Promise.resolve({ id: "connection" }) });
    const response = await update({ jwt: "***", storageState: "[REDACTED]", cookie: "••••", workspaceId: "new" });
    expect(response.status).toBe(200);
    expect(mocks.update.mock.lastCall[1].providerSpecificData).toEqual({ ...stored, workspaceId: "new" });
    expect((await response.json()).connection.providerSpecificData).toEqual({ workspaceId: "new" });
    expect((await update({ jwt: "new-jwt", storageState: { cookies: ["new"] } })).status).toBe(200);
    expect(mocks.update.mock.lastCall[1].providerSpecificData).toMatchObject({ jwt: "new-jwt", storageState: { cookies: ["new"] }, cookie: "old-cookie" });
  });

  it("hides credential-shaped providerSpecificData reads in executors and utilities", () => {
    const reads = new Set();
    for (const dir of ["open-sse/executors", "open-sse/utils"]) {
      for (const file of sourceFiles(join(root, dir))) {
        const source = readFileSync(file, "utf8");
        for (const match of source.matchAll(/\bproviderSpecificData\s*(?:\?\.|\.)\s*([a-zA-Z_$][\w$]*)/g)) {
          if (credentialName.test(match[1])) reads.add(match[1]);
        }
      }
    }
    expect([...reads].sort()).toEqual([...credentialReads, ...Object.keys(nonSecrets)].sort());
    const data = Object.fromEntries(credentialReads.map((key) => [key, "secret"]));
    expect(pickSafeProviderSpecificData("x", data)).toEqual({});
    const safe = Object.fromEntries(Object.keys(nonSecrets).map((key) => [key, "setting"]));
    expect(pickSafeProviderSpecificData("x", safe)).toEqual(safe);
  });
});
