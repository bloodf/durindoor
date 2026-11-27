import { afterEach, describe, expect, it, vi } from "vitest";
import { exchangeTokens, generateAuthData, requestDeviceCode } from "../../src/lib/oauth/providers.js";
import { GitlabExecutor } from "../../open-sse/executors/gitlab.js";
import { refreshTokenByProvider } from "../../open-sse/services/tokenRefresh.js";

const storage = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/lib/localDb", () => ({ createProviderConnection: storage.create }));

afterEach(() => { vi.unstubAllGlobals(); storage.create.mockReset(); });

describe("GitLab production contracts", () => {
  it.each(["gitlab", "gitlab-duo"])("rejects unsupported %s device sign-in before transport", async (provider) => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(requestDeviceCode(provider)).rejects.toThrow("does not support device code flow");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["gitlab", "gitlab-duo"])("does not expose a rejected %s exchange body", async (provider) => {
    const fetch = vi.fn().mockResolvedValue(new Response("synthetic-secret-in-error", { status: 401 }));
    vi.stubGlobal("fetch", fetch);
    await expect(exchangeTokens(provider, "code", "http://localhost/callback", "verifier", "state", {
      baseUrl: "https://gitlab.example.com", clientId: "client",
    })).rejects.toThrow(/^GitLab(?: Duo)? token exchange failed$/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps concurrent Duo exchanges bound to their own client, verifier and instance", async () => {
    const fetch = vi.fn(async (url, init) => {
      if (String(url).endsWith("/oauth/token")) {
        const body = new URLSearchParams(init.body);
        return Response.json({ access_token: `access-${body.get("client_id")}` });
      }
      return Response.json({ username: init.headers.Authorization });
    });
    vi.stubGlobal("fetch", fetch);
    const metas = ["one", "two"].map((id) => ({ baseUrl: `https://${id}.example.com`, clientId: id }));
    const auth = await Promise.all(metas.map((meta) => generateAuthData("gitlab-duo", "http://localhost/callback", meta)));
    expect(auth[0].state).not.toBe(auth[1].state);
    const results = await Promise.all(metas.map((meta, i) => exchangeTokens("gitlab-duo", `code-${i}`, auth[i].redirectUri, auth[i].codeVerifier, auth[i].state, meta)));
    for (const [i, meta] of metas.entries()) {
      expect(results[i]).toMatchObject({ accessToken: `access-${meta.clientId}`, providerSpecificData: { ...meta, username: `Bearer access-${meta.clientId}` } });
      const call = fetch.mock.calls.find(([url]) => url === `${meta.baseUrl}/oauth/token`);
      expect(new URLSearchParams(call[1].body).get("code_verifier")).toBe(auth[i].codeVerifier);
    }
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it.each(["gitlab", "gitlab-duo"])("verifies and stores a %s PAT using the existing route", async (provider) => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ username: "synthetic-user" }));
    vi.stubGlobal("fetch", fetch);
    const { POST } = await import("../../src/app/api/oauth/gitlab/pat/route.js");
    const response = await POST({ json: async () => ({ provider, baseUrl: "https://gitlab.example.com", token: "synthetic-pat" }) });
    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][1]).toMatchObject({ headers: { "Private-Token": "synthetic-pat" }, redirect: "manual" });
    expect(storage.create).toHaveBeenCalledWith(expect.objectContaining({ provider, accessToken: "synthetic-pat", providerSpecificData: expect.objectContaining({ authKind: "personal_access_token" }) }));
  });

  it("preserves concurrent Duo instance and credential identity", async () => {
    const fetch = vi.fn(async (url, init) => Response.json({ choices: [{ text: `${url}:${init.headers.Authorization}` }] }));
    vi.stubGlobal("fetch", fetch);
    const executor = new GitlabExecutor();
    const results = await Promise.all(["one", "two"].map((id) => executor.execute({ model: "example", body: { messages: [{ role: "user", content: id }] }, stream: false,
      credentials: { accessToken: `token-${id}`, providerSpecificData: { baseUrl: `https://${id}.example.com`, projectPath: `project-${id}` } } })));
    for (const [i, id] of ["one", "two"].entries()) {
      const result = await results[i].response.json();
      expect(result.choices[0].message.content).toContain(`https://${id}.example.com/api/v4/code_suggestions/completions:Bearer token-${id}`);
      const call = fetch.mock.calls.find(([url]) => String(url).startsWith(`https://${id}.example.com/`));
      expect(JSON.parse(call[1].body).project_path).toBe(`project-${id}`);
    }
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("refreshes concurrent accounts against their own instance and client", async () => {
    const fetch = vi.fn(async (_url, init) => Response.json({ access_token: `new-${init.body.get("client_id")}`, expires_in: 3600 }));
    vi.stubGlobal("fetch", fetch);
    const results = await Promise.all(["one", "two"].map((id) => refreshTokenByProvider("gitlab-duo", {
      refreshToken: `refresh-${id}`, providerSpecificData: { baseUrl: `https://${id}.example.com`, clientId: id },
    }, null)));
    for (const [i, id] of ["one", "two"].entries()) {
      expect(results[i]).toMatchObject({ accessToken: `new-${id}`, refreshToken: `refresh-${id}`, providerSpecificData: { baseUrl: `https://${id}.example.com`, clientId: id } });
      const call = fetch.mock.calls.find(([url]) => String(url) === `https://${id}.example.com/oauth/token`);
      expect(call[1].body.get("refresh_token")).toBe(`refresh-${id}`);
      expect(call[1].body.get("client_id")).toBe(id);
    }
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not submit an already aborted Duo request", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    controller.abort();
    await expect(new GitlabExecutor().execute({ model: "example", body: { messages: [] }, stream: false, signal: controller.signal,
      credentials: { accessToken: "synthetic", providerSpecificData: { baseUrl: "https://gitlab.example.com" } } })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns invalid_grant for a rejected Duo refresh without returning the upstream body", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("synthetic-private-body", { status: 401 }));
    vi.stubGlobal("fetch", fetch);
    const result = await refreshTokenByProvider("gitlab-duo", { refreshToken: "refresh", providerSpecificData: { baseUrl: "https://gitlab.example.com", clientId: "client" } }, null);
    expect(result).toEqual({ error: "invalid_grant" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("translates a Duo completion into a buffered event stream with one upstream submission", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ choices: [{ text: "answer" }], usage: { total_tokens: 7 } }));
    vi.stubGlobal("fetch", fetch);
    const result = await new GitlabExecutor().execute({ model: "example", body: { messages: [{ role: "user", content: "hello" }] }, stream: true,
      credentials: { accessToken: "synthetic-token", providerSpecificData: { baseUrl: "https://gitlab.example.com" } } });
    const body = await result.response.text();
    expect(body).toContain('"content":"answer"');
    expect(body).toContain('"total_tokens":7');
    expect(body).toContain("data: [DONE]");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("staged GitLab integration guards", () => {
  it("scopes deployment secrets to the configured instance and path", async () => {
    const { gitlabDeploymentSecret } = await import("../../src/lib/oauth/providerParity/gitlab/guards.js");
    expect(gitlabDeploymentSecret("https://gitlab.example.com/", "https://gitlab.example.com", "secret")).toBe("secret");
    for (const base of ["https://other.example.com", "https://gitlab.example.com/other", "https://gitlab.example.com/?x=1", "https://user@gitlab.example.com", "invalid"]) {
      expect(gitlabDeploymentSecret(base, "https://gitlab.example.com", "secret")).toBe("");
    }
  });

  it("constructs errors without accepting upstream content", async () => {
    const { gitlabRequestError } = await import("../../src/lib/oauth/providerParity/gitlab/guards.js");
    expect(gitlabRequestError(401)).toEqual({ error: { message: "GitLab Duo authentication failed", type: "authentication_error" } });
    expect(gitlabRequestError(500)).toEqual({ error: { message: "GitLab Duo request failed", type: "api_error" } });
  });
});
