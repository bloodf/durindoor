import { afterEach, expect, it, vi } from "vitest";
import { POST } from "@/app/api/providers/validate/route.js";

const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });

it.each(["minimax", "minimax-cn"])("allows enough output tokens when validating %s", async (provider) => {
  global.fetch = vi.fn().mockResolvedValue({ status: 200, ok: true });
  const response = await POST(new Request("http://localhost/api/providers/validate", {
    method: "POST",
    body: JSON.stringify({ provider, apiKey: "test-key" }),
  }));
  expect((await response.json()).valid).toBe(true);
  expect(JSON.parse(global.fetch.mock.calls[0][1].body).max_tokens).toBe(10);
});
