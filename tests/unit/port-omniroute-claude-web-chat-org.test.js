import { afterEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("../../open-sse/utils/proxyFetch.js", async (importOriginal) => ({ ...(await importOriginal()), proxyAwareFetch: fetchMock }));
import { getExecutor } from "../../open-sse/executors/index.js";

const API_ORG = { uuid: "org-api", capabilities: ["api"] };
const CHAT_ORG = { uuid: "org-chat", capabilities: ["chat", "claude_pro"] };
const OTHER_CHAT_ORG = { uuid: "org-active", capabilities: ["chat"] };

async function completionUrl(organizations, cookie = "sessionKey=synthetic-session") {
  fetchMock
    .mockResolvedValueOnce(new Response(JSON.stringify(organizations), { headers: { "content-type": "application/json" } }))
    .mockResolvedValueOnce(new Response(`data: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" } })}\n\n`));
  await getExecutor("claude-web").execute({
    model: "claude-sonnet-4-6",
    body: { messages: [{ role: "user", content: "hello" }] },
    stream: false,
    credentials: { apiKey: cookie },
  });
  return fetchMock.mock.calls[1][0];
}

describe("OmniRoute #21120 (149516b12d4d): Claude Web posts to an organization that can chat", () => {
  afterEach(() => fetchMock.mockReset());

  it("skips an API-only organization listed first", async () => {
    expect(await completionUrl([API_ORG, CHAT_ORG])).toContain("/organizations/org-chat/");
  });

  it("prefers the lastActiveOrg cookie when it names a listed organization", async () => {
    const url = await completionUrl([API_ORG, CHAT_ORG, OTHER_CHAT_ORG], "sessionKey=synthetic-session; lastActiveOrg=org-active");
    expect(url).toContain("/organizations/org-active/");
  });

  it("ignores a lastActiveOrg cookie that is not listed", async () => {
    const url = await completionUrl([API_ORG, CHAT_ORG], "sessionKey=synthetic-session; lastActiveOrg=org-gone");
    expect(url).toContain("/organizations/org-chat/");
  });

  it("falls back to the first usable record when none advertises chat", async () => {
    expect(await completionUrl([null, { name: "no id" }, { id: "org-legacy" }, API_ORG])).toContain("/organizations/org-legacy/");
  });
});
