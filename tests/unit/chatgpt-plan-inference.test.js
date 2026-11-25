import { describe, it, expect, vi } from "vitest";
import { listChatgptPlanModels } from "../../open-sse/providers/chatgpt-plan/index.js";
import { executeChatgptPlan } from "../../open-sse/executors/chatgpt-plan.js";

const connection = { id: "connection-1", accountId: "account-1", credentialClass: "chatgpt-plan-oauth", accessToken: "synthetic-token" };
const grant = { allowed: true, connectionId: "connection-1", accountId: "account-1" };
const catalog = () => Response.json({ models: [{ slug: "eligible", visibility: "list", display_name: "Eligible" }, { slug: "hidden", visibility: "hidden" }] });
const event = (value) => `data: ${JSON.stringify(value)}\n\n`;
const args = { connection, grant, model: "eligible", body: { input: "hello" } };

describe("private ChatGPT plan transport", () => {
  it.each([
    [{ ...connection, credentialClass: "api-key" }, grant],
    [{ ...connection, accessToken: "" }, grant],
    [connection, undefined], [connection, { ...grant, allowed: false }],
    [connection, { ...grant, connectionId: "other" }], [connection, { ...grant, accountId: "other" }],
  ])("rejects missing or mismatched authority before requests", async (selected, authority) => {
    const fetch = vi.fn();
    await expect(executeChatgptPlan({ ...args, connection: selected, grant: authority, fetch })).rejects.toThrow();
    await expect(listChatgptPlanModels({ connection: selected, grant: authority, fetch })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses the account catalog and forces the documented request", async () => {
    const completed = { type: "response.completed", response: { id: "r1", usage: { input_tokens: 3 } } };
    const fetch = vi.fn().mockResolvedValueOnce(catalog()).mockResolvedValueOnce(new Response(event(completed), { headers: { "content-type": "text/event-stream" } }));
    const response = await executeChatgptPlan({ ...args, body: { input: "hello", store: true, stream: false }, stream: false, fetch });
    expect(await response.json()).toEqual(completed.response);
    expect(fetch.mock.calls[0][0]).toBe("https://api.openai.com/v1/models");
    expect(fetch.mock.calls[1][0]).toBe("https://api.openai.com/v1/responses");
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({ model: "eligible", store: false, stream: true });
    expect(fetch.mock.calls[1][1].headers.Authorization).toBe("Bearer synthetic-token");
  });

  it("rejects hidden models without inference", async () => {
    const fetch = vi.fn().mockResolvedValue(catalog());
    await expect(executeChatgptPlan({ ...args, model: "hidden", fetch })).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("forwards SSE and detects interrupted streams", async () => {
    const wire = event({ type: "response.output_text.delta", delta: "hi" }) + event({ type: "response.completed", response: { usage: { output_tokens: 1 } } });
    const fetch = vi.fn().mockResolvedValueOnce(catalog()).mockResolvedValueOnce(new Response(wire));
    expect(await (await executeChatgptPlan({ ...args, fetch })).text()).toBe(wire);
    fetch.mockResolvedValueOnce(catalog()).mockResolvedValueOnce(new Response(event({ type: "response.output_text.delta", delta: "hi" })));
    await expect((await executeChatgptPlan({ ...args, fetch })).text()).rejects.toThrow("interrupted");
  });

  it("preserves plan-limit failure details and HTTP errors", async () => {
    const failure = { type: "response.failed", response: { error: { code: "subscription_sharing_usage_limit_exceeded" } } };
    const fetch = vi.fn().mockResolvedValueOnce(catalog()).mockResolvedValueOnce(new Response(event(failure)));
    const response = await executeChatgptPlan({ ...args, stream: false, fetch });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual(failure.response);
    fetch.mockResolvedValueOnce(catalog()).mockResolvedValueOnce(Response.json({ error: "limited" }, { status: 429 }));
    expect((await executeChatgptPlan({ ...args, fetch })).status).toBe(429);
  });
});
