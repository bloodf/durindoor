/**
 * #2034: the Z.ai Web opaque CAPTCHA proof is a secret under all three exact
 * providerSpecificData aliases. Public provider handlers hide it, scrubbed
 * exports drop it, and new writes encrypt it in SQLite, while the selected
 * account's internal credentials still resolve its own proof.
 *
 * Synthetic values only, against a private DATA_DIR SQLite database and the
 * actual public provider handlers. No operator authority is mocked. Nothing
 * here validates a proof against Z.ai or claims a proof TTL.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isEncryptedBlob } from "../../src/lib/crypto/columnCrypto.js";
import { omitMaskedProviderSecrets, pickSafeProviderSpecificData } from "../../src/lib/providerRouteHandlers.js";
import { isSensitiveProviderSpecificDataKey, scrubProviderSpecificDataForExport } from "../../src/lib/db/helpers/providerSpecificDataSecrets.js";
import { resolveZaiCaptchaVerifyParam } from "../../open-sse/executors/zai-web/session.js";

const ALIASES = ["captcha_verify_param", "captchaVerifyParam", "zaiCaptchaVerifyParam"];
// Credential-free captcha/settings metadata must stay visible: exact keys only.
const PUBLIC_METADATA = { captchaProvider: "synthetic-provider", captchaMode: "manual", workspaceId: "synthetic-workspace" };
const proofs = (account) => Object.fromEntries(ALIASES.map((key) => [key, `synthetic-proof-${account}-${key}`]));
const jwt = (uid) => `header.${Buffer.from(JSON.stringify({ id: uid })).toString("base64url")}.signature`;

let root, routes, byId, repo, db;
const request = (url, body, method = "POST") => new Request(`http://gateway.invalid${url}`, {
  method, headers: { "Content-Type": "application/json" }, body: method === "GET" ? undefined : JSON.stringify(body),
});
const params = (id) => ({ params: Promise.resolve({ id }) });
const rawRow = (id) => db.get("SELECT data FROM providerConnections WHERE id = ?", [id]).data;
const expectNoProof = (value, account) => {
  const text = JSON.stringify(value);
  for (const proof of Object.values(proofs(account))) expect(text).not.toContain(proof);
  for (const key of ALIASES) expect(text).not.toContain(`"${key}"`);
};

async function create(account) {
  const response = await routes.providers.POST(request("/api/providers", {
    provider: "zai-web", name: `zai-${account}`, apiKey: `token=${jwt(account)}`,
    providerSpecificData: { ...proofs(account), ...PUBLIC_METADATA },
  }));
  expect(response.status).toBe(201);
  const { connection } = await response.json();
  expectNoProof(connection, account);
  expect(connection.providerSpecificData).toMatchObject(PUBLIC_METADATA);
  return connection;
}
const put = (id, providerSpecificData) => byId.PUT(request(`/api/providers/${id}`, { providerSpecificData }, "PUT"), params(id));

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "zai-proof-boundary-"));
  vi.stubEnv("DATA_DIR", path.join(root, "data")); vi.stubEnv("HOME", path.join(root, "home")); vi.stubEnv("DURINDOOR_DATABASE_ENGINE", "sqlite");
  for (const key of ["DURINDOOR_PG_URL", "DURINDOOR_PG_SSLMODE", "DURINDOOR_DATABASE_ENV_SOURCE_JSON"]) vi.stubEnv(key, undefined);
  fs.mkdirSync(process.env.HOME, { recursive: true }); delete global._dbAdapter; vi.resetModules();
  routes = { providers: await import("../../src/app/api/providers/route.js") };
  byId = await import("../../src/app/api/providers/[id]/route.js");
  repo = await import("@/lib/db/repos/connectionsRepo.js");
  db = await (await import("@/lib/db/driver.js")).getAdapter();
}, 60000);

afterEach(async () => {
  try { await global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  vi.unstubAllEnvs(); vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true });
});

describe("Z.ai Web opaque proof metadata boundary (#2034)", () => {
  it("classifies exactly the three proof aliases as secrets", () => {
    const stored = { ...proofs("unit"), ...PUBLIC_METADATA };
    expect(pickSafeProviderSpecificData("zai-web", stored)).toEqual(PUBLIC_METADATA);
    for (const key of ALIASES) expect(isSensitiveProviderSpecificDataKey(key)).toBe(true);
    for (const key of Object.keys(PUBLIC_METADATA)) expect(isSensitiveProviderSpecificDataKey(key)).toBe(false);
    expect(omitMaskedProviderSecrets({ captchaVerifyParam: "***", captchaMode: "***" })).toEqual({ captchaMode: "***" });
    expect(JSON.stringify(scrubProviderSpecificDataForExport(stored))).not.toContain("synthetic-proof");
  });

  it("hides, encrypts, preserves, replaces, and isolates proofs through public handlers and SQLite", async () => {
    const a = await create("a");
    const b = await create("b");

    for (const [connection, account] of [[a, "a"], [b, "b"]]) {
      const raw = rawRow(connection.id);
      for (const proof of Object.values(proofs(account))) expect(raw).not.toContain(proof);
      const psd = JSON.parse(raw).providerSpecificData;
      for (const key of ALIASES) expect(isEncryptedBlob(psd[key])).toBe(true);
      expect(psd).toMatchObject(PUBLIC_METADATA);
      const read = await repo.getProviderConnectionById(connection.id);
      expect(read.providerSpecificData).toMatchObject({ ...proofs(account), ...PUBLIC_METADATA });
      expect(resolveZaiCaptchaVerifyParam(read, {})).toBe(proofs(account).captcha_verify_param);
    }

    const list = await (await routes.providers.GET(request("/api/providers", null, "GET"))).json();
    const listed = list.connections.filter((c) => c.provider === "zai-web");
    expect(listed).toHaveLength(2);
    for (const account of ["a", "b"]) expectNoProof(listed, account);
    for (const c of listed) expect(c.providerSpecificData).toMatchObject(PUBLIC_METADATA);
    const single = await (await byId.GET(request(`/api/providers/${a.id}`, null, "GET"), params(a.id))).json();
    expectNoProof(single, "a");

    const apiKeyBefore = JSON.parse(rawRow(a.id)).apiKey;
    const masked = await put(a.id, { captcha_verify_param: "***", captchaVerifyParam: "[REDACTED]", zaiCaptchaVerifyParam: "••••", captchaMode: "auto" });
    expect(masked.status).toBe(200);
    expectNoProof(await masked.json(), "a");
    let read = await repo.getProviderConnectionById(a.id);
    expect(read.providerSpecificData).toMatchObject({ ...proofs("a"), captchaMode: "auto" });

    const omitted = await put(a.id, { captchaMode: "manual" });
    expect(omitted.status).toBe(200);
    read = await repo.getProviderConnectionById(a.id);
    expect(read.providerSpecificData).toMatchObject({ ...proofs("a"), captchaMode: "manual" });

    const replaced = await put(a.id, { captchaVerifyParam: "synthetic-proof-a-replacement" });
    expect(replaced.status).toBe(200);
    const replacedBody = JSON.stringify(await replaced.json());
    expect(replacedBody).not.toContain("synthetic-proof-a-replacement");
    const raw = rawRow(a.id);
    expect(raw).not.toContain("synthetic-proof-a-replacement");
    expect(isEncryptedBlob(JSON.parse(raw).providerSpecificData.captchaVerifyParam)).toBe(true);
    read = await repo.getProviderConnectionById(a.id);
    expect(read.providerSpecificData.captchaVerifyParam).toBe("synthetic-proof-a-replacement");
    expect(read.providerSpecificData.captcha_verify_param).toBe(proofs("a").captcha_verify_param);
    // The stored apiKey keeps its value and stays encrypted. Its envelope IV is
    // refreshed by every connection update already (repo behavior predating #2034).
    expect(read.apiKey).toBe(`token=${jwt("a")}`);
    expect(isEncryptedBlob(apiKeyBefore)).toBe(true);
    expect(isEncryptedBlob(JSON.parse(raw).apiKey)).toBe(true);
    expect(raw).not.toContain(jwt("a"));

    // Account B is untouched by every update to A.
    const readB = await repo.getProviderConnectionById(b.id);
    expect(readB.providerSpecificData).toMatchObject({ ...proofs("b"), ...PUBLIC_METADATA });
    expect(resolveZaiCaptchaVerifyParam(readB, {})).toBe(proofs("b").captcha_verify_param);
    expect(JSON.stringify(readB)).not.toContain("synthetic-proof-a");
  });

  it("drops proofs from scrubbed exports but keeps public metadata", async () => {
    const a = await create("a");
    const { exportDb } = await import("@/lib/db/index.js");
    const payload = await exportDb({ includeSecrets: false });
    expectNoProof(payload, "a");
    const exported = payload.providerConnections.find((c) => c.id === a.id);
    expect(exported).toBeTruthy();
  });
});
