import { expect, it, vi } from "vitest";
const testProxyUrl = vi.hoisted(() => vi.fn());
vi.mock("@/lib/network/proxyTest", () => ({ testProxyUrl }));
const { POST } = await import("../../src/app/api/settings/proxy-test/route.js");
it("forwards the selected destination to the guarded proxy test", async () => {
  testProxyUrl.mockResolvedValue({ ok: true, status: 200 });
  const response = await POST(new Request("http://localhost/api/settings/proxy-test", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ proxyUrl: "http://proxy:8080", testUrl: "https://example.com/" }),
  }));
  expect(response.status).toBe(200);
  expect(testProxyUrl).toHaveBeenCalledWith(expect.objectContaining({ testUrl: "https://example.com/" }));
});
