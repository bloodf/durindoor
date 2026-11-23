// Port of decolua/9router#4876: OpenCode Go's Claude lane needs the client's beta
// flags plus the context-management pair, and rejects output_config.task_budget.
import { describe, expect, it } from "vitest";
import { OpenCodeGoExecutor } from "../../open-sse/executors/opencode-go.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { stripUnsupportedParams } from "../../open-sse/translator/concerns/paramSupport.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

const CLAUDE_TRANSPORT = {
  format: "claude",
  baseUrl: "https://opencode.ai/inference/go/anthropic/v1/messages",
  auth: { combined: true, header: "x-api-key", scheme: "raw", anthropicVersion: true },
};

function headersFor(model, body, clientBeta) {
  const credentials = { apiKey: "k", connectionId: "c", rawHeaders: {}, runtimeTransport: CLAUDE_TRANSPORT };
  const executor = new OpenCodeGoExecutor();
  executor.transformRequest(model, structuredClone(body), true, credentials);
  const requestContext = clientBeta ? { clientHeaders: { "anthropic-beta": clientBeta } } : {};
  return executor.buildHeaders(credentials, true, requestContext, model);
}
const flags = (h) => String(h["Anthropic-Beta"] || "").split(",").filter(Boolean);
const body = { messages: [{ role: "user", content: "hi" }], context_management: { edits: [] } };

describe("opencode-go Claude lane beta flags (#4876)", () => {
  it("forwards client flags and pairs context-management", () => {
    const h = headersFor("claude-haiku-5-5", body, "fine-grained-tool-streaming-2025-05-14");
    expect(flags(h)).toEqual(expect.arrayContaining(["fine-grained-tool-streaming-2025-05-14", "context-management-2025-06-27"]));
  });

  it("adds the pair flag when client sent none but body has context_management", () => {
    expect(flags(headersFor("claude-haiku-5-5", body))).toEqual(["context-management-2025-06-27"]);
  });

  it("does not forward Claude Code identity flags", () => {
    const h = headersFor("claude-haiku-5-5", body, "claude-code-20250219,context-management-2025-06-27");
    expect(flags(h)).not.toContain("claude-code-20250219");
  });

  it("sends no beta header when nothing applies", () => {
    expect(headersFor("claude-haiku-5-5", { messages: [] })["Anthropic-Beta"]).toBeUndefined();
  });

  it("does not leak the pair flag onto non-Claude models or other providers", () => {
    const credentials = { apiKey: "k", connectionId: "c", rawHeaders: {} };
    const ocg = new OpenCodeGoExecutor();
    ocg.transformRequest("glm-5.3", structuredClone(body), true, credentials);
    expect(ocg.buildHeaders(credentials, true, { clientHeaders: { "anthropic-beta": "context-management-2025-06-27" } }, "glm-5.3")["Anthropic-Beta"]).toBeUndefined();
    const other = new DefaultExecutor("deepseek");
    other.transformRequest("claude-haiku-5-5", structuredClone(body), true, credentials);
    expect(other.buildHeaders(credentials, true, {}, "claude-haiku-5-5")["Anthropic-Beta"]).toBeUndefined();
  });
});

describe("opencode-go claude task_budget strip (#4876)", () => {
  it("drops task_budget, keeps effort and context_management on Claude models only", () => {
    const claude = { context_management: { edits: [] }, output_config: { effort: "high", task_budget: { type: "tokens", total: 5 } } };
    stripUnsupportedParams("opencode-go", "claude-haiku-5-5", claude);
    expect(claude.output_config).toEqual({ effort: "high" });
    expect(claude.context_management).toEqual({ edits: [] });

    const empty = { output_config: { task_budget: { total: 1 } } };
    stripUnsupportedParams("opencode-go", "claude-haiku-5-5", empty);
    expect(empty).not.toHaveProperty("output_config");

    const other = { output_config: { task_budget: { total: 1 } } };
    stripUnsupportedParams("opencode-go", "deepseek-v4-pro", other);
    expect(other.output_config.task_budget).toBeDefined();
    const foreign = { output_config: { task_budget: { total: 1 } } };
    stripUnsupportedParams("claude", "claude-haiku-5-5", foreign);
    expect(foreign.output_config.task_budget).toBeDefined();
  });

  it("keeps adaptive thinking for claude-haiku-5-5 on opencode-go only", () => {
    expect(getCapabilitiesForModel("opencode-go", "claude-haiku-5-5").thinkingFormat).toBe("claude-adaptive");
  });
});
