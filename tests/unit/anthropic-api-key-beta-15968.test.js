// G-a2-4 / OmniRoute #15968: the plain Anthropic API-key provider must not
// claim the Claude Code identity.
//
// `anthropic` is an API-key provider: it does not use the Claude Code wire
// protocol and is not an OAuth session. Sending `claude-code-20250219` labels
// the request as Claude Code traffic, and Anthropic's Max/Team monthly API
// credits do not cover Claude Code usage (OmniRoute #15942).
//
// The Claude Code / OAuth header sets keep their identity betas, and an
// anthropic-compatible node that configures its own `Anthropic-Beta` keeps
// that value.
import { describe, expect, it } from "vitest";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import {
  CLAUDE_CODE_IDENTITY_BETAS,
  CLAUDE_FIRST_PARTY_ANTHROPIC_BETA,
  buildClaudeOAuthAnthropicBeta,
  withoutClaudeCodeIdentityBetas,
} from "../../open-sse/providers/shared.js";

const CC_BETA = "claude-code-20250219";
const OAUTH_BETA = "oauth-2025-04-20";

const tokens = (header) => new Set(String(header || "").split(",").map((v) => v.trim()).filter(Boolean));

const readHeader = (headers, name) => {
  const value = new Headers(headers).get(name);
  expect(value, `missing ${name}`).not.toBeNull();
  return value;
};

describe("Anthropic API-key beta flags (OmniRoute #15968)", () => {
  it.each([false, true])("omits the Claude Code identity for an API key (stream=%s)", (stream) => {
    const headers = new DefaultExecutor("anthropic").buildHeaders({ apiKey: "fixture-api-key" }, stream);
    const betas = tokens(readHeader(headers, "anthropic-beta"));

    expect(betas.has(CC_BETA)).toBe(false);
    expect(betas.has(OAUTH_BETA)).toBe(false);
    expect(headers["x-api-key"]).toBe("fixture-api-key");
    expect(headers["x-app"]).toBeUndefined();
    expect(headers["X-App"]).toBeUndefined();
    expect(readHeader(headers, "anthropic-version")).toBe("2023-06-01");
    // The executor only pins Accept for a streaming request.
    if (stream) expect(headers.Accept).toBe("text/event-stream");
    else expect(headers.Accept).toBeUndefined();
  });

  it("keeps the functional API betas on the API-key path", () => {
    const headers = new DefaultExecutor("anthropic").buildHeaders({ apiKey: "fixture-api-key" }, false);
    const betas = tokens(readHeader(headers, "anthropic-beta"));

    expect(betas.has("interleaved-thinking-2025-05-14")).toBe(true);
    expect(betas.size).toBeGreaterThan(0);
  });

  it("drops only the identity betas from a beta header value", () => {
    const filtered = withoutClaudeCodeIdentityBetas(
      "claude-code-20250219,interleaved-thinking-2025-05-14,oauth-2025-04-20",
    );
    expect(filtered).toBe("interleaved-thinking-2025-05-14");
    expect(withoutClaudeCodeIdentityBetas("claude-code-20250219")).toBeNull();
    expect(withoutClaudeCodeIdentityBetas("")).toBeNull();
    expect(withoutClaudeCodeIdentityBetas(null)).toBeNull();
    expect(CLAUDE_CODE_IDENTITY_BETAS).toContain(CC_BETA);
    expect(CLAUDE_CODE_IDENTITY_BETAS).toContain(OAUTH_BETA);
  });

  it("keeps the Claude Code and OAuth identity in the full and OAuth sets", () => {
    expect(tokens(CLAUDE_FIRST_PARTY_ANTHROPIC_BETA).has(CC_BETA)).toBe(true);
    expect(tokens(buildClaudeOAuthAnthropicBeta()).has(CC_BETA)).toBe(true);
    expect(tokens(buildClaudeOAuthAnthropicBeta()).has(OAUTH_BETA)).toBe(true);
  });

  it("keeps the Claude Code identity on the Claude Code OAuth provider", () => {
    const headers = new DefaultExecutor("claude").buildHeaders({ accessToken: "fixture-oauth" }, false);
    const betas = tokens(readHeader(headers, "anthropic-beta"));

    expect(betas.has(CC_BETA)).toBe(true);
    expect(betas.has(OAUTH_BETA)).toBe(true);
    expect(headers.Authorization).toBe("Bearer fixture-oauth");
    expect(headers["X-App"]).toBe("cli");
  });

  it("keeps the Claude Code identity on the Claude Code API-key path", () => {
    const headers = new DefaultExecutor("claude").buildHeaders({ apiKey: "fixture-api-key" }, false);
    expect(tokens(readHeader(headers, "anthropic-beta")).has(CC_BETA)).toBe(true);
  });

  it("still forwards a client-negotiated functional beta on the Claude Code provider", () => {
    const headers = new DefaultExecutor("claude").buildHeaders(
      { accessToken: "fixture-oauth" },
      true,
      { "anthropic-beta": "thinking-binding-controls-2026-08-01" },
    );
    expect(tokens(readHeader(headers, "anthropic-beta")).has("thinking-binding-controls-2026-08-01")).toBe(true);
  });
});
