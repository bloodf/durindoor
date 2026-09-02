import { describe, expect, it } from "vitest";

import "../translator/registerAll.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import claude from "../../open-sse/providers/registry/claude.js";
import {
  CLAUDE_CLI_SPOOF_HEADERS,
  mapStainlessArch,
  mapStainlessOs,
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
  it("emits the current CLI fingerprint for the host OS and architecture", () => {
    expect(claude.transport.headers).toBe(CLAUDE_CLI_SPOOF_HEADERS);
    expect(CLAUDE_CLI_SPOOF_HEADERS).toMatchObject({
      "User-Agent": "claude-code/2.1.258",
      "X-Stainless-Package-Version": "0.94.0",
      "X-Stainless-Os": mapStainlessOs(),
      "X-Stainless-Arch": mapStainlessArch(),
    });
    expect(mapStainlessOs("darwin")).toBe("MacOS");
    expect(mapStainlessOs("other-os")).toBe("Other::other-os");
    expect(mapStainlessArch("ia32")).toBe("x86");
    expect(mapStainlessArch("other-arch")).toBe("other::other-arch");
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
    expect(body.system[0].text).toMatch(/cc_version=2\.1\.258\.[0-9a-f]{3};/);
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
