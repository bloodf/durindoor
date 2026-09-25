// Port of OmniRoute #14694: Claude Code attaches two anthropic-beta values
// while auto mode is active — dangerous-tool-use-2026-09-03 (already
// allowlisted) and afk-mode-2026-01-31 (dropped by the allowlist merge).
// Without the second, the upstream never sees the full auto-mode
// negotiation. This allowlists afk-mode-2026-01-31 alongside it.
import { describe, expect, it } from "vitest";
import { FORWARDABLE_CLIENT_BETAS, mergeForwardableClientBetas } from "../../open-sse/providers/shared.js";

describe("port 14694 — forward the Claude Code auto-mode afk-mode beta", () => {
  it("allowlists afk-mode-2026-01-31", () => {
    expect(FORWARDABLE_CLIENT_BETAS.has("afk-mode-2026-01-31")).toBe(true);
  });

  it("forwards both auto-mode betas together, exactly once, when the client sends them", () => {
    const headers = mergeForwardableClientBetas(
      { "anthropic-beta": "claude-code-20250219" },
      { "anthropic-beta": "dangerous-tool-use-2026-09-03,afk-mode-2026-01-31,afk-mode-2026-01-31" }
    );
    expect(headers["anthropic-beta"]).toBe(
      "claude-code-20250219,dangerous-tool-use-2026-09-03,afk-mode-2026-01-31"
    );
  });

  it("does not invent afk-mode-2026-01-31 when the client did not send it", () => {
    const headers = mergeForwardableClientBetas(
      { "anthropic-beta": "claude-code-20250219" },
      { "anthropic-beta": "dangerous-tool-use-2026-09-03" }
    );
    expect(headers["anthropic-beta"]).toBe("claude-code-20250219,dangerous-tool-use-2026-09-03");
  });
});
