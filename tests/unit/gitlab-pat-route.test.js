import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let createdConnection = null;
const fetchMock = vi.fn();

vi.mock("@/models", () => ({
  createProviderConnection: vi.fn(async (data) => {
    createdConnection = data;
    return { id: "conn-1", ...data };
  }),
}));

vi.stubGlobal("fetch", fetchMock);

function makeRequest(body) {
  return {
    json: async () => body,
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("GitLab PAT route", () => {
  beforeEach(() => {
    createdConnection = null;
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("creates a gitlab-duo connection when provider is gitlab-duo", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ username: "duo-user", name: "Duo User", email: "duo@example.com" })
    );

    const { POST } = await import("../../src/app/api/oauth/gitlab/pat/route.js");
    const response = await POST(makeRequest({
      provider: "gitlab-duo",
      token: "glpat-123",
      baseUrl: "https://gitlab.example.com",
    }));

    expect(response.status).toBe(200);
    expect(createdConnection.provider).toBe("gitlab-duo");
    expect(createdConnection.accessToken).toBe("glpat-123");
    expect(createdConnection.providerSpecificData.baseUrl).toBe("https://gitlab.example.com");
  });

  it("defaults to gitlab provider when provider is omitted", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ username: "gitlab-user", name: "GitLab User", email: "gl@example.com" })
    );

    const { POST } = await import("../../src/app/api/oauth/gitlab/pat/route.js");
    await POST(makeRequest({ token: "glpat-456" }));

    expect(createdConnection.provider).toBe("gitlab");
  });

  it("rejects unsupported provider values", async () => {
    const { POST } = await import("../../src/app/api/oauth/gitlab/pat/route.js");
    const response = await POST(makeRequest({ provider: "cursor", token: "glpat-789" }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/Unsupported provider/);
    expect(createdConnection).toBeNull();
  });
});
