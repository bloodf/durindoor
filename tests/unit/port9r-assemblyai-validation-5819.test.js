import { describe, expect, it, vi } from "vitest";
import { probeAssemblyAiKey } from "open-sse/services/assemblyai.js";
import { POST } from "@/app/api/providers/validate/route.js";

describe("AssemblyAI credential probe", () => {
  it.each([[200, true, null], [401, false, "Invalid API key"], [403, false, "Invalid API key"], [429, false, "Unable to verify API key (AssemblyAI returned 429)"], [503, false, "Unable to verify API key (AssemblyAI returned 503)"]])("handles HTTP %s", async (status, valid, error) => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status }));
    expect(await probeAssemblyAiKey("test-key", fetcher)).toEqual({ valid, error });
    expect(fetcher).toHaveBeenCalledWith("https://api.assemblyai.com/v2/transcript?limit=1", { headers: { Authorization: "test-key" } });
  });
});

it("validates a new AssemblyAI key using the raw key", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", fetcher);
  try {
    const response = await POST(new Request("http://localhost/api/providers/validate", {
      method: "POST", body: JSON.stringify({ provider: "assemblyai", apiKey: "test-key" }),
    }));
    expect(await response.json()).toEqual({ valid: true, error: null });
    expect(fetcher).toHaveBeenCalledWith("https://api.assemblyai.com/v2/transcript?limit=1", expect.objectContaining({ headers: { Authorization: "test-key" } }));
  } finally {
    vi.unstubAllGlobals();
  }
});
