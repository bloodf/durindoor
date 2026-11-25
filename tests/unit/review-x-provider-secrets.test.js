import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { pickSafeProviderSpecificData } from "../../src/lib/providerRouteHandlers.js";
import { mergeProviderSpecificData } from "../../src/lib/db/helpers/mergeProviderMetadata.js";

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
