import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  proxyAwareFetch: vi.fn(),
}));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: mocks.proxyAwareFetch,
}));

import { KiroExecutor } from "../../open-sse/executors/kiro.js";

function requestBody(conversationId) {
  return {
    systemPrompt: "Follow the system instructions",
    profileArn: "arn:aws:codewhisperer:us-east-1:123456789012:profile/test",
    conversationState: {
      conversationId,
      currentMessage: { userInputMessage: { content: "Hello" } },
      history: [],
    },
  };
}

describe("KiroExecutor systemPrompt surface compatibility", () => {
  beforeEach(() => {
    mocks.proxyAwareFetch.mockReset();
    mocks.proxyAwareFetch.mockResolvedValue(new Response(new Uint8Array(), { status: 200 }));
  });

  it("drops systemPrompt for kiro.dev while retaining it for CodeWhisperer", async () => {
    const executor = new KiroExecutor();

    await executor.execute({
      model: "claude-sonnet-4.5",
      body: requestBody("kiro-dev-request"),
      stream: true,
      credentials: {
        accessToken: "social-token",
        connectionId: "social-connection",
        providerSpecificData: { authMethod: "social" },
      },
      proxyOptions: { disableEnvProxy: true },
    });

    await executor.execute({
      model: "claude-sonnet-4.5",
      body: requestBody("codewhisperer-request"),
      stream: true,
      credentials: {
        accessToken: "api-key",
        connectionId: "api-key-connection",
        providerSpecificData: { authMethod: "api_key" },
      },
      proxyOptions: { disableEnvProxy: true },
    });

    expect(mocks.proxyAwareFetch.mock.calls[0][0]).toContain(".kiro.dev");
    expect(JSON.parse(mocks.proxyAwareFetch.mock.calls[0][1].body)).not.toHaveProperty("systemPrompt");
    expect(mocks.proxyAwareFetch.mock.calls[1][0]).toContain("codewhisperer.us-east-1.amazonaws.com");
    expect(JSON.parse(mocks.proxyAwareFetch.mock.calls[1][1].body).systemPrompt).toBe("Follow the system instructions");
  });
});
