import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { providerRefreshContext } from "@/shared/utils/providerCredentialContext.js";
import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

const dispatch = vi.hoisted(() => vi.fn());
vi.mock("open-sse/handlers/chatCore.js", () => ({ handleChatCore: dispatch }));

const provider = "chatgpt-web";
const model = "gpt-5-6";
const original = "synthetic-original-cookie";
const imported = "synthetic-imported-cookie";
const rotated = "synthetic-rotated-cookie";
let directory;
let repo;
let handleChat;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "durindoor-cookie-cas-"));
  vi.stubEnv("DATA_DIR", directory);
  vi.stubEnv("DURINDOOR_DATABASE_ENGINE", "sqlite");
  vi.stubEnv("DURINDOOR_PG_URL", undefined);
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Unexpected outbound fetch"); }));
  delete global._dbAdapter;
  vi.resetModules();
  dispatch.mockReset();
  repo = await import("@/lib/db/repos/connectionsRepo.js");
  ({ handleChat } = await import("@/sse/handlers/chat.js"));
});

afterEach(async () => {
  await disposeLoadedRequestDetailsRepo();
  await global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await rm(directory, { recursive: true, force: true });
});

function createCookieConnection() {
  return repo.createProviderConnection({
    provider, authType: "cookie", apiKey: original, name: "Cookie fixture",
  });
}

function startChat() {
  return handleChat(new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: `${provider}/${model}`,
      messages: [{ role: "user", content: "hello" }],
    }),
  }));
}

function holdRotations(count) {
  const ready = Promise.withResolvers();
  const release = Promise.withResolvers();
  const results = [];
  let arrivals = 0;
  dispatch.mockImplementation(async ({ credentials, onCredentialsRefreshed }) => {
    const index = arrivals++;
    if (arrivals === count) ready.resolve();
    const candidates = await release.promise;
    results[index] = await onCredentialsRefreshed({ ...credentials, apiKey: candidates[index] });
    return { success: true, response: new Response("fixture response") };
  });

  const requests = Array.from({ length: count }, () => startChat());
  const responses = Promise.all(requests);
  return {
    ready: Promise.race([
      ready.promise,
      ...requests.map(async (request) => {
        const response = await request;
        throw new Error(`Gateway completed before dispatch (status ${response.status})`);
      }),
    ]),
    async finish(candidates) {
      release.resolve(candidates);
      for (const response of await responses) {
        expect(await response.text()).toBe("fixture response");
      }
      return results;
    },
  };
}

it("rejects a delayed gateway rotation after the operator replaces the cookie", async () => {
  const { id } = await createCookieConnection();
  const turn = holdRotations(1);
  await turn.ready;
  expect(dispatch.mock.calls[0][0].credentials.apiKey).toBe(original);
  await repo.updateProviderConnection(id, { provider, apiKey: imported, testStatus: "active" });

  expect(await turn.finish([rotated])).toEqual([false]);
  expect(await repo.getProviderConnectionById(id)).toMatchObject({ apiKey: imported, testStatus: "active" });
  dispatch.mockImplementationOnce(async ({ credentials }) => {
    expect(credentials.apiKey).toBe(imported);
    return { success: true, response: new Response("fixture response") };
  });
  expect(await (await startChat()).text()).toBe("fixture response");
});

it("applies a gateway rotation when the cookie is unchanged and preserves metadata edits", async () => {
  const { id } = await createCookieConnection();
  const turn = holdRotations(1);
  await turn.ready;
  await repo.updateProviderConnection(id, { name: "Edited fixture" });

  expect(await turn.finish([rotated])).toEqual([true]);
  expect(await repo.getProviderConnectionById(id)).toMatchObject({ apiKey: rotated, name: "Edited fixture" });
});

it("commits exactly one of two concurrent rotations of the same cookie", async () => {
  const { id } = await createCookieConnection();
  const turn = holdRotations(2);
  const candidates = [rotated, "synthetic-competing-cookie"];
  await turn.ready;

  const results = await turn.finish(candidates);
  expect(results.filter(Boolean)).toHaveLength(1);
  expect(results).toContain(false);
  expect((await repo.getProviderConnectionById(id)).apiKey).toBe(candidates[results.indexOf(true)]);
});

it("does not replay a rejected HTTP rotation from the session token cache", async () => {
  const { ChatGptWebHttpExecutor } = await import("open-sse/executors/chatgpt-web-http.js");
  const { __setTlsFetchOverrideForTesting } = await import("open-sse/services/chatgptTlsClient.js");
  let exchanges = 0;
  __setTlsFetchOverrideForTesting(async (url) => {
    if (String(url) === "https://chatgpt.com/api/auth/session") {
      exchanges++;
      return {
        status: 200,
        headers: new Headers(exchanges === 1
          ? { "set-cookie": `__Secure-next-auth.session-token=${rotated}; Path=/; HttpOnly` }
          : {}),
        text: JSON.stringify({ accessToken: "synthetic-session-access" }),
        body: null,
      };
    }
    return { status: 403, headers: new Headers(), text: "{}", body: null };
  });
  const onCredentialsRefreshed = vi.fn(async () => false);
  const executor = new ChatGptWebHttpExecutor();
  const input = {
    model,
    body: { messages: [{ role: "user", content: "hello" }] },
    credentials: { apiKey: original },
    onCredentialsRefreshed,
  };
  try {
    await executor.execute(input);
    await executor.execute(input);
    expect(exchanges).toBe(2);
    expect(onCredentialsRefreshed).toHaveBeenCalledOnce();
  } finally {
    __setTlsFetchOverrideForTesting(null);
  }
});

it.each([
  { id: "different-connection" },
  { provider: "grok-web" },
  { authType: "oauth" },
  { providerSpecificData: { storageState: { cookies: [] } } },
])("rejects a repository rotation from a different session context (%j)", async (overrides) => {
  const connection = await createCookieConnection();
  const result = await repo.updateProviderConnection(connection.id, { apiKey: rotated }, {
    expectedRefreshContext: providerRefreshContext({ ...connection, ...overrides }),
    returnCommitResult: true,
  });

  expect(result?.applied).toBe(false);
  expect((await repo.getProviderConnectionById(connection.id)).apiKey).toBe(original);
});

it("keeps OAuth refresh comparison and merge behavior", async () => {
  const connection = await repo.createProviderConnection({
    provider: "github", authType: "oauth", name: "OAuth fixture",
    accessToken: "synthetic-access-token", refreshToken: "synthetic-refresh-token",
  });
  const options = {
    expectedRefreshContext: providerRefreshContext(connection),
    returnCommitResult: true,
  };
  await repo.updateProviderConnection(connection.id, { name: "Edited fixture", apiKey: "synthetic-unrelated-key" });

  const first = await repo.updateProviderConnection(connection.id, { accessToken: "synthetic-new-access" }, options);
  expect(first).toMatchObject({
    applied: true,
    connection: { name: "Edited fixture", apiKey: "synthetic-unrelated-key", accessToken: "synthetic-new-access" },
  });
  const second = await repo.updateProviderConnection(connection.id, { accessToken: "synthetic-stale-access" }, options);
  expect(second).toMatchObject({ applied: false, connection: { accessToken: "synthetic-new-access" } });
});
