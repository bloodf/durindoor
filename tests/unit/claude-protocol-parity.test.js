import { describe, expect, it } from "vitest";

import "../translator/registerAll.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import claude from "../../open-sse/providers/registry/claude.js";
import {
  CLAUDE_CLI_SPOOF_HEADERS,
  CLAUDE_FIRST_PARTY_ANTHROPIC_BETA,
  CLAUDE_THIRD_PARTY_ANTHROPIC_BETA,
  mapStainlessArch,
  mapStainlessOs,
  selectAnthropicBeta,
} from "../../open-sse/providers/shared.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const translateToClaude = (body, credentials, sourceFormat = FORMATS.OPENAI) => translateRequest(
  sourceFormat,
  FORMATS.CLAUDE,
  "claude-fable-5",
  body,
  true,
  credentials,
  "claude",
  null,
  [],
  "connection-123"
);

describe("direct Claude protocol parity", () => {
  it("matches the Claude Code 2.1.312 first-party fingerprint", () => {
    expect(claude.transport.headers).toBe(CLAUDE_CLI_SPOOF_HEADERS);
    expect(CLAUDE_CLI_SPOOF_HEADERS).toEqual({
      "Anthropic-Version": "2023-06-01",
      "Anthropic-Beta": CLAUDE_FIRST_PARTY_ANTHROPIC_BETA,
      "Anthropic-Dangerous-Direct-Browser-Access": "true",
      "User-Agent": "claude-cli/2.1.312 (external, sdk-cli)",
      "X-App": "cli",
      "X-Stainless-Retry-Count": "0",
      "X-Stainless-Runtime-Version": "v26.12.1",
      "X-Stainless-Package-Version": "0.128.0",
      "X-Stainless-Runtime": "node",
      "X-Stainless-Lang": "js",
      "X-Stainless-Arch": mapStainlessArch(),
      "X-Stainless-Os": mapStainlessOs(),
      "X-Stainless-Timeout": "600",
    });
    expect(CLAUDE_CLI_SPOOF_HEADERS["Anthropic-Beta"]).toBe(
      "claude-code-20250219,interleaved-thinking-2025-05-14,context-management-2025-06-27,prompt-caching-scope-2026-01-05,per-turn-control-2026-07-01,mid-conversation-tool-changes-2026-07-01,thinking-token-count-2026-05-13,advanced-tool-use-2025-11-20,effort-2025-11-24,thinking-binding-controls-2026-08-01,cache-diagnosis-2026-04-07",
    );
    expect(CLAUDE_CLI_SPOOF_HEADERS).not.toHaveProperty("X-Stainless-Helper-Method");
  });

  it("keeps selectAnthropicBeta on the pre-PR third-party string without first-party-gated flags", () => {
    expect(CLAUDE_THIRD_PARTY_ANTHROPIC_BETA).toBe(
      "claude-code-20250219,interleaved-thinking-2025-05-14,thinking-token-count-2026-05-13,context-management-2025-06-27,prompt-caching-scope-2026-01-05,mid-conversation-system-2026-04-07,effort-2025-11-24,fallback-credit-2026-06-01",
    );
    const sonnet = selectAnthropicBeta("claude-sonnet-5-5");
    expect(sonnet).toBe(
      "claude-code-20250219,interleaved-thinking-2025-05-14,thinking-token-count-2026-05-13,context-management-2025-06-27,prompt-caching-scope-2026-01-05,mid-conversation-system-2026-04-07,fallback-credit-2026-06-01,effort-2025-11-24",
    );
    expect(sonnet).not.toContain("thinking-binding-controls-2026-08-01");
    expect(sonnet).not.toContain("cache-diagnosis-2026-04-07");
    // Non-opus/sonnet models omit the heavy-agent effort flag.
    const haiku = selectAnthropicBeta("claude-haiku-4-5");
    expect(haiku).toBe(
      "claude-code-20250219,interleaved-thinking-2025-05-14,thinking-token-count-2026-05-13,context-management-2025-06-27,prompt-caching-scope-2026-01-05,mid-conversation-system-2026-04-07,fallback-credit-2026-06-01",
    );
    expect(haiku).not.toContain("effort-2025-11-24");
  });

  it("emits the captured client session id in headers and cloaked metadata", () => {
    const credentials = {
      accessToken: "sk-ant-oat-test",
      rawHeaders: { "x-session-id": "session-123" },
    };
    const body = translateToClaude(
      { messages: [{ role: "user", content: "hello" }] },
      credentials
    );
    const headers = new DefaultExecutor("claude").buildHeaders(credentials, true);

    expect(credentials._clientSessionId).toBe("session-123");
    expect(headers["X-Claude-Code-Session-Id"]).toBe("session-123");
    expect(JSON.parse(body.metadata.user_id).session_id).toBe("session-123");
    expect(body.system[0].text).toMatch(/cc_version=2\.1\.312\.[0-9a-f]{3};/);
  });

  it("omits the Claude session header when no client session id is present", () => {
    const credentials = { accessToken: "sk-ant-oat-test" };
    translateToClaude(
      { messages: [{ role: "user", content: "hello" }] },
      credentials
    );
    const headers = new DefaultExecutor("claude").buildHeaders(credentials, true);

    expect(credentials._clientSessionIsGenerated).toBe(true);
    expect(headers).not.toHaveProperty("X-Claude-Code-Session-Id");
    expect(headers).not.toHaveProperty("x-claude-code-session-id");
  });

  it("keeps native Claude metadata aligned with the session header", () => {
    const credentials = { accessToken: "sk-ant-oat-test" };
    const body = translateToClaude(
      {
        metadata: { user_id: JSON.stringify({ session_id: "session-456" }) },
        messages: [{ role: "user", content: "hello" }],
      },
      credentials,
      FORMATS.CLAUDE
    );
    const headers = new DefaultExecutor("claude").buildHeaders(credentials, true);

    expect(JSON.parse(body.metadata.user_id).session_id).toBe("session-456");
    expect(headers["X-Claude-Code-Session-Id"]).toBe("session-456");
  });
});
