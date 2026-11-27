import { describe, expect, it, vi } from "vitest";

const proxy = vi.hoisted(() => vi.fn(async (body, options) => {
  if (options.format !== "claude") return null;
  body.messages[0].content[0].text = "short";
  return { tokens_saved: 10 };
}));
vi.mock("../../open-sse/rtk/headroom.js", () => ({ compressWithHeadroom: proxy }));
import { runCompressionSeam } from "../../open-sse/handlers/chatCore/compressionHook.js";

describe("#2289 compression boundaries", () => {
  it("passes Claude format to the headroom stack and skips an already applied pass", async () => {
    const body = { messages: [{ role: "user", content: [{ type: "text", text: "a long message to compress" }] }] };
    const cfg = { enabled: true, engines: { headroom: { enabled: true, url: "http://localhost:8787" } }, applyOpts: { format: "claude", enabled: true, url: "http://localhost:8787" } };
    proxy.mockClear();
    const result = await runCompressionSeam(body, undefined, cfg);
    expect(result.body.messages[0].content[0].text).toBe("short");
    expect(proxy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ format: "claude" }));
    proxy.mockClear();
    await runCompressionSeam(body, undefined, { ...cfg, applyOpts: { ...cfg.applyOpts, headroomApplied: true } });
    expect(proxy).not.toHaveBeenCalled();
  });

});
