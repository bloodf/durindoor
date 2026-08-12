import { afterEach, describe, expect, it, vi } from "vitest";
import { handleChatCore } from "../../open-sse/handlers/chatCore.js";
import { VertexExecutor } from "../../open-sse/executors/vertex.js";

// `src/sse/handlers/chat.js:986` passes `refreshedCredentials` straight into
// `handleChatCore`; the previous `{ ...rawCredentials }` boundary cloned only the
// top level, so any Kiro or Vertex write into `providerSpecificData.*` (e.g. the
// `profileArn` cache write at open-sse/executors/kiro.js:390/:406) mutated the
// caller's credential object. These tests drive the real mutation paths through
// the executors (not the `Warmup`/`{`/`count` bypass branch in
// open-sse/utils/bypassHandler.js:25-45) and assert the caller object is
// untouched. `src/sse/services/auth.js:157-190` attaches `_connection` and
// `_quotaPreflight` references onto the credentials object, so we only clone
// the top level and `providerSpecificData` — never a deep recursive copy.

const NON_BYPASS_PROMPT = "isolation-fixture-prompt";

describe("credential metadata isolation", () => {
  it("keeps request metadata off caller credentials through handleChatCore", async () => {
    const credentials = {
      connectionId: "conn-isolation-1",
      apiKey: "iso-openai-1",
      providerSpecificData: { region: "us-east-1" },
    };
    const original = structuredClone(credentials);

    await handleChatCore({
      body: { messages: [{ role: "user", content: NON_BYPASS_PROMPT }] },
      modelInfo: { provider: "openai", model: "gpt-4o" },
      credentials,
      clientRawRequest: {
        endpoint: "/v1/chat/completions",
        body: { messages: [{ role: "user", content: NON_BYPASS_PROMPT }] },
        headers: { "x-sensitive-user-header": "secret-value-iso-1" },
      },
      userAgent: "iso-ua-1",
    });

    expect(credentials).toEqual(original);
    expect(credentials.runtimeTransport).toBeUndefined();
    expect(credentials.rawHeaders).toBeUndefined();
    expect(credentials._clientSessionId).toBeUndefined();
  });

  it("keeps Kiro profileArn write off caller providerSpecificData", async () => {
    const credentials = {
      accessToken: `iso-kiro-${Date.now()}-${Math.random()}`,
      providerSpecificData: { region: "eu-central-1", authMethod: "idc" },
    };
    const original = structuredClone(credentials);
    const arn = "arn:aws:codewhisperer:eu-central-1:966063511238:profile/ISO_KIRO";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ profiles: [{ arn }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response("profile test stops after executor dispatch", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);

    await handleChatCore({
      body: { model: "claude-sonnet-4.5", stream: false, messages: [{ role: "user", content: NON_BYPASS_PROMPT }] },
      modelInfo: { provider: "kiro", model: "claude-sonnet-4.5" },
      credentials,
      clientRawRequest: {
        endpoint: "/v1/chat/completions",
        body: { messages: [{ role: "user", content: NON_BYPASS_PROMPT }] },
        headers: {},
      },
      userAgent: "iso-kiro-ua",
    });

    expect(credentials).toEqual(original);
    expect(credentials.providerSpecificData.profileArn).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].body).toContain(arn);
  });

  it("keeps Vertex service-account token and projectId off caller credentials", async () => {
    const executor = new VertexExecutor("vertex");
    const saJson = JSON.stringify({
      type: "service_account",
      client_email: "iso-vertex@example.test",
      private_key: "-----BEGIN PRIVATE KEY-----\niso\n-----END PRIVATE KEY-----\n",
      project_id: "iso-vertex-project",
    });
    const credentials = { apiKey: saJson, providerSpecificData: {} };
    const original = structuredClone(credentials);

    const refreshVertexToken = vi.fn().mockResolvedValue({
      accessToken: "iso-vertex-rotated",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    vi.doMock("../../open-sse/services/tokenRefresh.js", async (importOriginal) => ({
      ...(await importOriginal()),
      parseVertexSaJson: (apiKey) =>
        typeof apiKey === "string" ? JSON.parse(apiKey) : null,
      refreshVertexToken,
    }));

    try {
      const { VertexExecutor: VertexExecutorFresh } = await import(
        "../../open-sse/executors/vertex.js?isolation-vertex=1"
      );
      const isolated = new VertexExecutorFresh("vertex");

      await isolated.execute({
        model: "iso-vertex-model",
        body: { messages: [{ role: "user", content: "iso-vertex-prompt" }] },
        stream: false,
        credentials,
      });
    } finally {
      vi.doUnmock("../../open-sse/services/tokenRefresh.js");
    }

    expect(credentials).toEqual(original);
    expect(credentials.accessToken).toBeUndefined();
    expect(credentials.providerSpecificData.projectId).toBeUndefined();
    expect(refreshVertexToken).toHaveBeenCalledTimes(1);
  });

  it("keeps Vertex partner-key projectId off caller providerSpecificData", async () => {
    const executor = new VertexExecutor("vertex-partner");
    const credentials = {
      apiKey: "iso-vertex-partner-key-1",
      providerSpecificData: {},
    };
    const original = structuredClone(credentials);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({
          error: { message: "projects/iso-resolved-project/locations/global" },
        }),
      })
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await executor.execute({
      model: "iso-vertex-partner-model",
      body: { messages: [{ role: "user", content: "iso-vertex-partner-prompt" }] },
      stream: false,
      credentials,
    });

    expect(credentials).toEqual(original);
    expect(credentials.accessToken).toBeUndefined();
    expect(credentials.providerSpecificData.projectId).toBeUndefined();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.doUnmock("../../open-sse/services/tokenRefresh.js");
  vi.resetModules();
});
