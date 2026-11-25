import { afterEach, describe, expect, it, vi } from "vitest";
import { PromptQlExecutor } from "../../open-sse/executors/promptql.js";

const PROJECT = "synthetic-project";
const GQL = "https://data.prompt.ql.app/promptql/playground-v2-hge/v1/graphql";
const cookie = "next-auth.session-token=synthetic-session";
const jwt = (claims) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.synthetic`;
const token = jwt({ iss: "enrich-token", exp: 4_102_444_800, projectId: PROJECT });
const json = (data) => new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });

afterEach(() => vi.restoreAllMocks());

describe("PromptQL issue 2464", () => {
  it("persists the refreshed session before returning models", async () => {
    const fetch = vi.fn(async (url) => url.includes("/graphql")
      ? json({ data: { llm_config: [{ id: "model-a" }] } })
      : json({ token }));
    const onCredentialsRefreshed = vi.fn();
    const executor = new PromptQlExecutor({ fetch });

    const result = await executor.execute({
      action: "models",
      credentials: { apiKey: cookie, providerSpecificData: { projectId: PROJECT } },
      onCredentialsRefreshed,
    });

    expect(result.models).toEqual([{ id: "model-a" }]);
    expect(onCredentialsRefreshed).toHaveBeenCalledWith({
      accessToken: token,
      promptqlSession: { promptqlSessionHash: expect.any(String), promptqlSessionProjectId: PROJECT },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("rejects with AbortError when the client aborts during poll sleep", async () => {
    const controller = new AbortController();
    const fetch = vi.fn(async (url, init) => {
      if (url !== GQL) throw new Error(`Unexpected URL: ${url}`);
      const operation = JSON.parse(init.body).operationName;
      if (operation === "StartThreadRoomless") return json({ data: { start_thread: { thread_id: "thread-a" } } });
      if (operation === "QueryThreadEvents") {
        setTimeout(() => controller.abort(new DOMException("client disconnected", "AbortError")), 0);
        return json({ data: { thread_events: [] } });
      }
      throw new Error(`Unexpected operation: ${operation}`);
    });
    const executor = new PromptQlExecutor({ fetch });

    await expect(executor.execute({
      model: "promptql/model-a",
      body: { messages: [{ role: "user", content: "hello" }] },
      credentials: { apiKey: token, providerSpecificData: { projectId: PROJECT } },
      signal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
