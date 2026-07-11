import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;

function updateRequest(body) {
  return new Request("https://durindoor.local/api/providers/connection-id", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("provider proxy reassignment", () => {
  let tempDir = null;

  afterEach(() => {
    vi.doUnmock("next/server");
    vi.doUnmock("@/shared/services/quotaAutoPing");
    vi.resetModules();
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  it("persists strict reassignment, omission, and an explicit direct clear", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-proxy-reassign-"));
    process.env.DATA_DIR = tempDir;
    vi.resetModules();
    vi.doMock("next/server", () => ({
      NextResponse: {
        json(body, init = {}) {
          return new Response(JSON.stringify(body), {
            status: init.status || 200,
            headers: { "Content-Type": "application/json" },
          });
        },
      },
    }));
    vi.doMock("@/shared/services/quotaAutoPing", () => ({
      notifyQuotaAutoPingSettingChanged: vi.fn(),
    }));

    const {
      createProviderConnection,
      createProxyPool,
      getProviderConnectionById,
    } = await import("@/models/index.js");
    const { resolveConnectionProxyConfig } = await import("@/lib/network/connectionProxy.js");
    const { PUT } = await import("@/app/api/providers/[id]/route.js");

    const connection = await createProviderConnection({
      provider: "codex",
      authType: "oauth",
      accessToken: "test-access-token",
      refreshToken: "test-refresh-token",
      email: "proxy-reassign@example.test",
      providerSpecificData: {
        accountId: "account-1",
        proxyPoolId: "old-pool",
        oauthProxy: {
          mode: "strict-pool",
          poolId: "old-pool",
          providerOwnedField: "keep",
        },
        nested: { keep: true },
      },
    });
    await createProxyPool({
      id: "new-pool",
      name: "New pool",
      proxyUrl: "http://127.0.0.1:8888",
      type: "http",
      isActive: true,
    });

    const assignResponse = await PUT(updateRequest({ proxyPoolId: "new-pool" }), {
      params: Promise.resolve({ id: connection.id }),
    });
    const assignedBody = await assignResponse.json();
    const assigned = await getProviderConnectionById(connection.id);

    expect(assignResponse.status).toBe(200);
    expect(assignedBody.connection.providerSpecificData).toMatchObject({
      accountId: "account-1",
      proxyPoolId: "new-pool",
      oauthProxy: {
        mode: "strict-pool",
        poolId: "new-pool",
        providerOwnedField: "keep",
      },
      nested: { keep: true },
    });
    expect(assigned.providerSpecificData).toEqual(
      assignedBody.connection.providerSpecificData,
    );

    const omittedResponse = await PUT(updateRequest({ name: "Renamed account" }), {
      params: Promise.resolve({ id: connection.id }),
    });
    const afterOmission = await getProviderConnectionById(connection.id);

    expect(omittedResponse.status).toBe(200);
    expect(afterOmission.providerSpecificData).toMatchObject({
      proxyPoolId: "new-pool",
      oauthProxy: { mode: "strict-pool", poolId: "new-pool" },
    });

    const clearResponse = await PUT(updateRequest({ proxyPoolId: null }), {
      params: Promise.resolve({ id: connection.id }),
    });
    const clearedBody = await clearResponse.json();
    const cleared = await getProviderConnectionById(connection.id);

    expect(clearResponse.status).toBe(200);
    expect(clearedBody.connection.providerSpecificData).toMatchObject({
      accountId: "account-1",
      proxyPoolId: null,
      oauthProxy: {
        mode: "direct",
        poolId: null,
        providerOwnedField: "keep",
      },
      nested: { keep: true },
    });
    expect(cleared.providerSpecificData).toEqual(
      clearedBody.connection.providerSpecificData,
    );
    await expect(resolveConnectionProxyConfig(cleared.providerSpecificData)).resolves.toMatchObject({
      source: "direct",
      disableEnvProxy: true,
      strictProxy: false,
    });
  }, 20_000);
});
