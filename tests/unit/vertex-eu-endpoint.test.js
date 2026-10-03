import { afterEach, describe, expect, it, vi } from "vitest";
import { VertexExecutor } from "../../open-sse/executors/vertex.js";

const project = "vertex-eu-project";
const gemini = "gemini-2.5-flash";

async function requestUrl(provider, credentials, stream = false) {
  const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  const executor = new VertexExecutor(provider);
  const result = await executor.execute({
    model: gemini,
    body: { contents: [{ role: "user", parts: [{ text: "hello" }] }] },
    stream,
    credentials,
    proxyOptions: { disableEnvProxy: true },
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(result.url).toBe(fetchMock.mock.calls[0][0]);
  return fetchMock.mock.calls[0][0];
}

describe("Vertex request endpoint", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends project-scoped EU Gemini stream to representative host with EU location", async () => {
    expect(await requestUrl("vertex", {
      accessToken: "test-token",
      providerSpecificData: { projectId: project, location: "eu" },
    }, true)).toBe(
      `https://aiplatform.eu.rep.googleapis.com/v1/projects/${project}/locations/eu/publishers/google/models/${gemini}:streamGenerateContent?alt=sse`
    );
  });

  it("keeps global and other regional project-scoped Gemini requests on global host", async () => {
    for (const location of ["global", "europe-west4"]) {
      expect(await requestUrl("vertex", {
        accessToken: "test-token",
        providerSpecificData: { projectId: project, location },
      })).toBe(
        `https://aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${gemini}:generateContent`
      );
    }
  });

  it("keeps EU-configured partner requests on global endpoint", async () => {
    expect(await requestUrl("vertex-partner", {
      accessToken: "test-token",
      providerSpecificData: { projectId: project, location: "eu" },
    })).toBe(
      `https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/endpoints/openapi/chat/completions`
    );
  });

  it("keeps raw-key Gemini requests on project-less global endpoint", async () => {
    expect(await requestUrl("vertex", {
      apiKey: "test-key",
      providerSpecificData: { projectId: project, location: "eu" },
    })).toBe(
      `https://aiplatform.googleapis.com/v1/publishers/google/models/${gemini}:generateContent?key=test-key`
    );
  });
});
