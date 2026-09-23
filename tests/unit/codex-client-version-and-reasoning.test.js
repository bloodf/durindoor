import { describe, expect, it } from "vitest";
import { CodexExecutor } from "../../open-sse/executors/codex.js";
import { CODEX_CLI_VERSION } from "../../open-sse/config/appConstants.js";
import {
  getCodexClientVersionFromHeaders,
  meetsMinimalCodexClientVersion,
} from "../../open-sse/config/codexClientVersion.js";
import { isCodexMultiAgentPlaintextTool } from "../../open-sse/translator/concerns/codexMultiAgent.js";
import { projectCompletionToClientFormat } from "../../open-sse/translator/response/completionProjector.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import codexImageAdapter from "../../open-sse/handlers/imageProviders/codex.js";

// Ports of OmniRoute Codex hardening changes onto the fork's own request/response
// shape. See omniroute-delta.md items 4 and 8.

// Minimal stand-in for the request-side namespace resolver completionProjector
// takes as an option: splits `namespace.tool` the way the real Codex/Claude
// dotted-name resolver would, without wiring a whole request context.
function splitDottedToolName(name) {
  const dot = name.indexOf(".");
  if (dot === -1) return { name };
  return { name: name.slice(dot + 1), namespace: name.slice(0, dot) };
}

describe("Codex caller-version forwarding (port OmniRoute fa23670ea #13708)", () => {
  it("reads an explicit Version header over the User-Agent", () => {
    expect(getCodexClientVersionFromHeaders({
      version: "0.160.2",
      "user-agent": "codex_cli_rs/0.140.0 (Mac OS 26.6.2; arm64)",
    })).toBe("0.160.2");
  });

  it("falls back to a codex_cli_rs/x.y.z User-Agent when no Version header is sent", () => {
    expect(getCodexClientVersionFromHeaders({
      "user-agent": "codex_cli_rs/0.160.2 (Windows 10.0.26200; x64)",
    })).toBe("0.160.2");
  });

  it("returns null when neither header yields a usable version", () => {
    expect(getCodexClientVersionFromHeaders({ "user-agent": "curl/8.1.0" })).toBeNull();
    expect(getCodexClientVersionFromHeaders(null)).toBeNull();
  });

  it("rejects a Version header that fails the safe-token pattern", () => {
    expect(getCodexClientVersionFromHeaders({ version: "not a token; drop table" })).toBeNull();
  });

  it("buildHeaders forwards the caller's version to Version and User-Agent", () => {
    const executor = new CodexExecutor();
    const headers = executor.buildHeaders(
      { connectionId: "c1" },
      true,
      { clientHeaders: { version: "0.160.2" } },
    );
    expect(headers.Version).toBe("0.160.2");
    expect(headers["User-Agent"]).toBe("codex_cli_rs/0.160.2");
  });

  it("buildHeaders falls back to the pinned CLI version without a caller version", () => {
    const executor = new CodexExecutor();
    const headers = executor.buildHeaders({ connectionId: "c1" }, true, {});
    expect(headers.Version).toBe(CODEX_CLI_VERSION);
    expect(headers["User-Agent"]).toBe(`codex_cli_rs/${CODEX_CLI_VERSION}`);
  });
});

describe("Codex CLI pin (port OmniRoute 252d604db #14052)", () => {
  it("is pinned to 0.155.0", () => {
    expect(CODEX_CLI_VERSION).toBe("0.155.0");
  });
});

describe("Codex model discovery minimal_client_version (port OmniRoute d5452d03e #12933)", () => {
  it("passes an absent gate", () => {
    expect(meetsMinimalCodexClientVersion(undefined)).toBe(true);
    expect(meetsMinimalCodexClientVersion("")).toBe(true);
  });

  it("passes a gate at or below the pinned version", () => {
    expect(meetsMinimalCodexClientVersion("0.155.0")).toBe(true);
    expect(meetsMinimalCodexClientVersion("0.100.0")).toBe(true);
  });

  it("fails a gate above the pinned version", () => {
    expect(meetsMinimalCodexClientVersion("0.200.0")).toBe(false);
  });
});

describe("Codex reasoning whitelist (port OmniRoute de428cef8 #14065)", () => {
  it("strips unrecognized reasoning keys, keeping only effort and summary", () => {
    const executor = new CodexExecutor();
    const body = executor.transformRequest("gpt-5.5", {
      input: "hi",
      reasoning: { effort: "high", max_tokens: 4000, verbosity: "low" },
    }, true, {});
    expect(body.reasoning).toEqual({ effort: "high", summary: "auto" });
  });

  it("maps enabled:false without an explicit effort to effort none", () => {
    const executor = new CodexExecutor();
    const body = executor.transformRequest("gpt-5.5", {
      input: "hi",
      reasoning: { enabled: false },
    }, true, {});
    expect(body.reasoning.effort).toBe("none");
    expect(body.reasoning.enabled).toBeUndefined();
  });

  it("keeps an explicit effort over enabled:false", () => {
    const executor = new CodexExecutor();
    const body = executor.transformRequest("gpt-5.5", {
      input: "hi",
      reasoning: { enabled: false, effort: "medium" },
    }, true, {});
    expect(body.reasoning.effort).not.toBe("none");
  });
});

describe("Codex MultiAgent encrypted_function_args marker (port OmniRoute 38cbb7ef8 #14447)", () => {
  it("recognizes only the three collaboration tool names", () => {
    expect(isCodexMultiAgentPlaintextTool({ name: "spawn_agent", namespace: "collaboration" })).toBe(true);
    expect(isCodexMultiAgentPlaintextTool({ name: "send_message", namespace: "collaboration" })).toBe(true);
    expect(isCodexMultiAgentPlaintextTool({ name: "followup_task", namespace: "collaboration" })).toBe(true);
    expect(isCodexMultiAgentPlaintextTool({ name: "exec", namespace: "collaboration" })).toBe(false);
    expect(isCodexMultiAgentPlaintextTool({ name: "spawn_agent", namespace: "other" })).toBe(false);
    expect(isCodexMultiAgentPlaintextTool(null)).toBe(false);
  });

  it("stamps the marker on a projected Responses function_call for a collaboration tool", () => {
    const completion = {
      id: "abc123",
      model: "gpt-5.5",
      choices: [{
        finish_reason: "tool_calls",
        message: {
          tool_calls: [{
            id: "call_1",
            function: { name: "collaboration.spawn_agent", arguments: "{}" },
          }],
        },
      }],
    };
    const projected = projectCompletionToClientFormat(completion, FORMATS.OPENAI_RESPONSES, {
      resolveToolName: splitDottedToolName,
    });
    const item = projected.output.find((o) => o.type === "function_call");
    expect(item.namespace).toBe("collaboration");
    expect(item.encrypted_function_args).toEqual([]);
  });

  it("does not stamp the marker on an unrelated function_call", () => {
    const completion = {
      id: "abc123",
      model: "gpt-5.5",
      choices: [{
        finish_reason: "tool_calls",
        message: {
          tool_calls: [{ id: "call_1", function: { name: "exec", arguments: "{}" } }],
        },
      }],
    };
    const projected = projectCompletionToClientFormat(completion, FORMATS.OPENAI_RESPONSES, {
      resolveToolName: splitDottedToolName,
    });
    const item = projected.output.find((o) => o.type === "function_call");
    expect(item.encrypted_function_args).toBeUndefined();
  });
});

describe("Codex image generation free-plan failover (port OmniRoute 79b2e92c4 #11948)", () => {
  it("rejects with a retryable 403 before dispatch on a free plan", () => {
    expect(() => codexImageAdapter.buildHeaders({
      accessToken: "token",
      providerSpecificData: { chatgptPlanType: "free" },
    })).toThrow(expect.objectContaining({ status: 403 }));
  });

  it("allows a non-free plan through", () => {
    expect(() => codexImageAdapter.buildHeaders({
      accessToken: "token",
      providerSpecificData: { chatgptPlanType: "plus" },
    })).not.toThrow();
  });
});
