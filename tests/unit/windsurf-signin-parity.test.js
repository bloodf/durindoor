import { afterEach, expect, it, vi } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: vi.fn() }));

afterEach(() => vi.clearAllMocks());

it("keeps Windsurf import-only and does not create refresh credentials", async () => {
  const { generateAuthData, getProvider } = await import("../../src/lib/oauth/providers.js");
  const auth = await generateAuthData("windsurf", "http://localhost/callback");
  expect(auth.flowType).toBe("import_token");
  expect(auth.authUrl).toBeNull();
  expect(getProvider("windsurf").mapTokens({ accessToken: "fake-account-a", refresh_token: "ignored" })).toEqual({
    accessToken: "fake-account-a", refreshToken: null, expiresIn: null,
    providerSpecificData: { authKind: "import_token" },
  });
});

it("binds each native request to its own credential and proxy", async () => {
  const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");
  proxyAwareFetch.mockImplementation(async () => new Response("mock stop", { status: 418 }));
  const { WindsurfExecutor } = await import("../../open-sse/executors/windsurf.js");
  const executor = new WindsurfExecutor();
  for (const [token, proxy] of [["fake-account-a", "proxy-a"], ["fake-account-b", "proxy-b"]]) {
    await executor.execute({ model: "swe-1.6-fast", body: { messages: [{ role: "user", content: "hello" }] },
      credentials: { accessToken: token }, proxyOptions: { proxyUrl: proxy } });
  }
  expect(proxyAwareFetch).toHaveBeenCalledTimes(2);
  for (const [index, token, other, proxy] of [[0, "fake-account-a", "fake-account-b", "proxy-a"], [1, "fake-account-b", "fake-account-a", "proxy-b"]]) {
    const [url, init, options] = proxyAwareFetch.mock.calls[index];
    expect(url).toContain("LanguageServerService/GetChatMessage");
    expect(init.headers.Authorization).toBe(`Bearer ${token}`);
    const payload = new TextDecoder().decode(init.body);
    expect(payload).toContain(token);
    expect(payload).not.toContain(other);
    expect(payload).toContain("swe-1-6-fast");
    expect(options).toEqual({ proxyUrl: proxy });
  }
});
