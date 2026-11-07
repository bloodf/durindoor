import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/dashboardGuard", () => ({ hasValidCliToken: async () => false, hasValidToken: async () => false, isAdminScopedKey: async () => true }));
vi.mock("@/lib/db/index.js", () => ({ getActiveRequests: async () => ({ activeRequests: [] }) }));

const gate = await import("../../open-sse/services/concurrencyGate.js");
const { GET } = await import("../../src/app/api/monitoring/metrics/route.js");
afterEach(() => gate._resetGates());

it("reports queued admission requests across gate module reloads without identifiers", async () => {
  vi.resetModules();
  const otherGate = await import("../../open-sse/services/concurrencyGate.js");
  await otherGate.acquireSlot("private-provider", 1);
  const waiting = otherGate.acquireSlot("private-provider", 1);
  const response = await GET(new Request("http://localhost/api/monitoring/metrics"));
  const body = await response.text();
  expect(response.status).toBe(200);
  expect(body).toContain("durindoor_admission_queued_requests 1\n");
  expect(body).not.toContain("private-provider");
  otherGate.releaseSlot("private-provider");
  await waiting;
  otherGate.releaseSlot("private-provider");
  expect(await (await GET(new Request("http://localhost/api/monitoring/metrics"))).text()).toContain("durindoor_admission_queued_requests 0\n");
});
