import { describe, expect, it, vi } from "vitest";
import { GithubExecutor } from "../../open-sse/executors/github.js";
import { clearCopilotModelCache, resolveCopilotModels } from "../../open-sse/services/copilotModels.js";

const { proxyAwareFetch } = vi.hoisted(() => ({ proxyAwareFetch: vi.fn() }));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch }));

describe("GitHub Copilot credential parity", () => {
  it("uses the scoped token and expiry stored by the device flow", () => {
    const executor = new GithubExecutor();
    const credentials = {
      accessToken: "github-token",
      providerSpecificData: {
        copilotToken: "copilot-token",
        copilotTokenExpiresAt: Math.floor(Date.now() / 1000) + 3600,
      },
    };
    expect(executor.buildHeaders(credentials).Authorization).toBe("Bearer copilot-token");
    expect(executor.needsRefresh(credentials)).toBe(false);
    credentials.providerSpecificData.copilotTokenExpiresAt = Math.floor(Date.now() / 1000) + 60;
    expect(executor.needsRefresh(credentials)).toBe(true);
  });
});

it("preserves account data when a scoped token is refreshed", async () => {
  const executor = new GithubExecutor();
  executor.refreshCopilotToken = async () => ({ token: "new-token", expiresAt: 1900000000 });
  const result = await executor.refreshCredentials({
    accessToken: "github-token",
    providerSpecificData: { githubUserId: 42, copilotToken: "old-token" },
  });
  expect(result.providerSpecificData).toEqual({ githubUserId: 42, copilotToken: "new-token", copilotTokenExpiresAt: 1900000000 });
});

it("refreshes GitHub credentials and retries the scoped exchange after a failure", async () => {
  proxyAwareFetch.mockReset()
    .mockResolvedValueOnce(new Response("denied", { status: 401 }))
    .mockResolvedValueOnce(Response.json({ access_token: "new-github", refresh_token: "new-refresh" }))
    .mockResolvedValueOnce(Response.json({ token: "new-scoped", expires_at: 1900000000 }));
  const result = await new GithubExecutor().refreshCredentials({ accessToken: "old-github", refreshToken: "old-refresh", providerSpecificData: { githubUserId: 42 } });
  expect(result).toMatchObject({ accessToken: "new-github", refreshToken: "new-refresh", copilotToken: "new-scoped", providerSpecificData: { githubUserId: 42, copilotToken: "new-scoped" } });
  expect(proxyAwareFetch).toHaveBeenCalledTimes(3);
});

it("returns null when the scoped exchange fails without a refresh credential", async () => {
  proxyAwareFetch.mockReset().mockResolvedValue(new Response("denied", { status: 403 }));
  expect(await new GithubExecutor().refreshCredentials({ accessToken: "github" })).toBeNull();
  expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
});

it.each([{ token: "", expires_at: 1900000000 }, { token: "expired", expires_at: 1 }, { token: "missing-expiry" }])("rejects invalid scoped refresh responses", async (payload) => {
  proxyAwareFetch.mockReset().mockResolvedValue(Response.json(payload));
  expect(await new GithubExecutor().refreshCopilotToken("github")).toBeNull();
});

it("preserves text from thinking parts and tolerates null parts", () => {
  const executor = new GithubExecutor();
  const result = executor.sanitizeMessagesForChatCompletions({ messages: [{ role: "user", content: [null, { type: "thinking", thinking: "reasoning" }] }] });
  expect(result.messages[0].content).toEqual([null, { type: "text", text: "reasoning" }]);
});

it("sends vision signaling and caps tools through the chat route", async () => {
  proxyAwareFetch.mockReset().mockResolvedValue(Response.json({ choices: [] }));
  const executor = new GithubExecutor();
  const tools = Array.from({ length: 130 }, (_, i) => ({ type: "function", function: { name: `tool${i}` } }));
  const body = { model: "gpt-4.1", messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AA==" } }] }], tools };
  const result = await executor.execute({ model: "gpt-4.1", body, stream: false, credentials: { accessToken: "github", providerSpecificData: { copilotToken: "scoped" } } });
  expect(result.response.status).toBe(200);
  const [, request] = proxyAwareFetch.mock.calls[0];
  expect(request.headers.Authorization).toBe("Bearer scoped");
  expect(request.headers["copilot-vision-request"]).toBe("true");
  expect(JSON.parse(request.body).tools).toHaveLength(128);
  expect(body.tools).toHaveLength(130);
});

it("discovers visible chat models even when capability type is absent", async () => {
  clearCopilotModelCache();
  proxyAwareFetch.mockReset().mockResolvedValue(Response.json({ data: [
    { id: "new-chat", supported_endpoints: ["/responses"] },
    { model: "new-default", display_name: "New default" },
    { id: "hidden", capabilities: { type: "chat" }, model_picker_enabled: false },
    { id: "embedding-model" },
    { id: "disabled", capabilities: { type: "chat" }, policy: { state: "disabled" } },
  ] }));
  const result = await resolveCopilotModels({ providerSpecificData: { copilotToken: "catalog-token" } });
  expect(result.models.map((model) => model.id)).toEqual(["new-chat", "new-default"]);
  expect(result.models[1].name).toBe("New default");
});
