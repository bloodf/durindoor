import { afterAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { withEarlyStreamKeepalive } from "../../open-sse/utils/earlyStreamKeepalive.js";
import { createFileTransaction } from "@/lib/cliTools/fileTransaction";

vi.mock("@/sse/services/auth.js", () => ({
  getProviderCredentialsWithQuotaPreflight: async () => ({ allRateLimited: true, lastErrorCode: 503, lastError: "Unavailable" }),
  projectProviderCredentials: vi.fn(),
}));
vi.mock("@/lib/webhooks/index.js", () => ({ notifyWebhookEvent: vi.fn() }));
vi.mock("@/dashboardGuard", () => ({ isOperatorRequest: async () => true, canManageAccessConfig: async () => true }));

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "review-2595-"));
const previous = process.env.DATA_DIR;
process.env.DATA_DIR = dir;
afterAll(async () => {
  if (previous === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previous;
  try { await global._dbAdapter?.instance?.close?.(); } catch { /* cleanup */ }
  delete global._dbAdapter;
  await fs.rm(dir, { recursive: true, force: true });
});

describe("issue 2598 regressions", () => {
  it("does not poll while the response is unread", async () => {
    const timeout = vi.spyOn(globalThis, "setTimeout");
    let resolve;
    const pending = new Promise((r) => { resolve = r; });
    const response = await withEarlyStreamKeepalive(pending, { thresholdMs: 0, intervalMs: 60000 });
    resolve(new Response(new ReadableStream({ pull(c) { c.enqueue(new TextEncoder().encode("data: x\n\n")); } }), { headers: { "content-type": "text/event-stream" } }));
    await new Promise((r) => setTimeout(r, 1100));
    expect(timeout.mock.calls.filter((call) => call[1] === 10)).toHaveLength(0);
    await response.body.cancel();
    timeout.mockRestore();
  });
  it("rolls back a dangling symlink target without removing the link", async () => {
    const link = path.join(dir, "link");
    const target = path.join(dir, "target");
    await fs.symlink("target", link);
    const tx = createFileTransaction();
    await tx.write(link, "new");
    await tx.rollback();
    expect((await fs.lstat(link)).isSymbolicLink()).toBe(true);
    await expect(fs.stat(target)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("preserves the last upstream error code when accounts become unavailable", async () => {
    const { selectCredentials } = await import("@/sse/handlers/chat/singleModel/credentials.js");
    const result = await selectCredentials({ provider: "openai", model: "test" }, {
      excludeConnectionIds: new Set(["failed"]), attemptedBlockers: [], lastErrorCode: "upstream_code", lastStatus: 503,
    });
    expect((await result.response.json()).error.code).toBe("upstream_code");
  });
  it.each([["azure", "azureEndpoint"], ["azure-openai", "baseUrl"]])("validates %s endpoint edits", async (provider, field) => {
    const { createProviderConnection } = await import("@/lib/localDb");
    const { PUT } = await import("@/app/api/providers/[id]/route.js");
    const connection = await createProviderConnection({ provider, name: provider, authType: "apikey", apiKey: "test", providerSpecificData: { [field]: "https://example.invalid" } });
    const update = (body) => PUT(new Request("http://localhost/api/providers/id", { method: "PUT", body: JSON.stringify(body) }), { params: Promise.resolve({ id: connection.id }) });
    expect((await update({ providerSpecificData: { [field]: "" } })).status).toBe(400);
    expect((await update({ name: "updated" })).status).toBe(200);
    expect((await update({ providerSpecificData: { [field]: "https://new.invalid" } })).status).toBe(200);
  });
});
