import { afterEach, describe, expect, it, vi } from "vitest";
import { getExecutor } from "open-sse/executors/index.js";
import huggingchat from "open-sse/providers/registry/huggingchat.js";
import huggingface from "open-sse/providers/registry/huggingface.js";

afterEach(() => vi.unstubAllGlobals());

describe("HuggingChat session boundary", () => {
  it("fails closed through provider dispatch without sending either fake credential", async () => {
    const fetch = vi.fn(() => { throw new Error("unexpected outbound request"); });
    vi.stubGlobal("fetch", fetch);
    for (const apiKey of ["hf-chat=fake-session", "hf_fake-inference-token"]) {
      const result = await getExecutor("huggingchat").execute({
        model: "example/model", body: { messages: [{ role: "user", content: "hello" }] },
        credentials: { apiKey }, stream: true,
      });
      expect(result.response.status).toBe(501);
      expect((await result.response.json()).error.type).toBe("provider_port_pending");
      expect(JSON.stringify(result.headers)).not.toContain(apiKey);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps the web session and inference token provider identities separate", () => {
    expect(huggingchat.authType).toBe("cookie");
    expect(huggingface.authType).toBe("apikey");
    expect(huggingchat.id).not.toBe(huggingface.id);
    expect(huggingchat.transport.baseUrl).toBe("https://huggingface.co/chat/conversation");
    expect(huggingface.imageConfig.baseUrl).toBe("https://router.huggingface.co");
  });
});
