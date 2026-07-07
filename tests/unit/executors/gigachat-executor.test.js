import { beforeEach, describe, expect, it, vi } from "vitest";
import { GigaChatExecutor } from "../../../open-sse/executors/gigachat.js";
import { proxyAwareFetch } from "../../../open-sse/utils/proxyFetch.js";

vi.mock("../../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

describe("GigaChatExecutor", () => {
  const executor = new GigaChatExecutor();

  beforeEach(() => {
    executor.tokenCache.clear();
    proxyAwareFetch.mockReset();
  });

  it("routes chat traffic to GigaChat chat completions", () => {
    expect(executor.buildUrl("GigaChat-2-Max", true)).toBe(
      "https://gigachat.devices.sberbank.ru/api/v1/chat/completions",
    );
  });

  it("uses the exchanged access token as bearer auth", () => {
    expect(executor.buildHeaders({ accessToken: "access-token" }, true)).toMatchObject({
      Authorization: "Bearer access-token",
      Accept: "text/event-stream",
    });
  });

  it("does not send the saved authorization key as a bearer API key", () => {
    const headers = executor.buildHeaders({ apiKey: "basic-secret" }, false);

    expect(headers.Authorization).toBeUndefined();
    expect(headers.Accept).toBeUndefined();
  });

  it("exchanges the saved authorization key for a GigaChat access token", async () => {
    proxyAwareFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "upstream-access", expires_in: 1800 }),
    });

    await expect(executor.exchangeApiKeyForAccessToken("basic-secret")).resolves.toBe("upstream-access");

    expect(proxyAwareFetch).toHaveBeenCalledWith(
      "https://ngw.devices.sberbank.ru:9443/api/v2/oauth",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Basic basic-secret",
          "Content-Type": "application/x-www-form-urlencoded",
          RqUID: expect.any(String),
        }),
        body: expect.any(URLSearchParams),
      }),
      null,
    );
    const body = proxyAwareFetch.mock.calls[0][1].body;
    expect(body.get("scope")).toBe("GIGACHAT_API_PERS");
  });
});
