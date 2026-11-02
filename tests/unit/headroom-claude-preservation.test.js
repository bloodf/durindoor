import { afterEach, describe, expect, it, vi } from "vitest";
import { compressWithHeadroom } from "../../open-sse/rtk/headroom.js";

afterEach(() => vi.unstubAllGlobals());

const options = { enabled: true, url: "http://headroom:8787", model: "claude-sonnet-4-5", format: "claude" };
const pdf = { type: "document", source: { type: "base64", media_type: "application/pdf", data: "JVBERi0xLjQK" }, title: "report.pdf" };

function makeBody() {
  return {
    system: [{ type: "text", text: "long system ".repeat(50), cache_control: { type: "ephemeral" } }],
    messages: [
      { role: "user", content: [{ type: "text", text: "summarize ".repeat(50) }, pdf] },
      { role: "assistant", content: [
        { type: "thinking", thinking: "private", signature: "sig" },
        { type: "tool_use", id: "toolu_1", name: "read_pdf", input: { path: "report.pdf" } },
      ] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: [{ type: "text", text: "extracted ".repeat(50) }, pdf] }] },
    ],
  };
}

describe("Claude Headroom fidelity (#4670 equivalent)", () => {
  it("never mutates or forwards PDFs, signed thinking or tool history to the proxy", async () => {
    const body = makeBody();
    const original = structuredClone(body);
    const diagnostics = {};
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => Response.json({
      messages: JSON.parse(init.body).messages.map((m) => ({ ...m, content: "short" })),
      tokens_before: 100, tokens_after: 10, tokens_saved: 90,
    })));
    expect(await compressWithHeadroom(body, { ...options, compressUserMessages: true, diagnostics })).toBeNull();
    expect(body).toEqual(original);
    expect(JSON.stringify(fetch.mock.calls)).not.toContain("JVBERi0xLjQK");
  });

  it("does nothing when disabled", async () => {
    const body = makeBody();
    const original = structuredClone(body);
    vi.stubGlobal("fetch", vi.fn());
    expect(await compressWithHeadroom(body, { ...options, enabled: false })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(body).toEqual(original);
  });
});
