// /api/oauth/*: every provider login "succeeds" without leaving the demo and
// creates a connected account. Authorization-code flows deliver their
// callback over the same BroadcastChannel the real /callback page uses.
import { badRequest } from "../../http.js";
import { connectOAuthAccount, sanitizeConnection } from "./shared.js";

const CALLBACK_DELAY_MS = 1800;
const DEVICE_POLLS_BEFORE_SUCCESS = 2;

// Flow bookkeeping only lives for the page session, like the server's flow map.
let flows = new Map();

function remember(flow) {
  flows = new Map([...flows, [flow.flowId, flow]]);
  return flow;
}

function randomToken(length = 24) {
  return Array.from({ length }, () => Math.floor(Math.random() * 36).toString(36)).join("");
}

function startFlow(provider, kind, body = {}) {
  return remember({ flowId: `flow-${randomToken(12)}`, state: randomToken(32), provider, kind, connectionId: body.connectionId || null, polls: 0, connection: null });
}

/** Complete a flow once; later completions return the same account. */
function completeFlow(store, flow, extra = {}) {
  if (flow.connection) return flow.connection;
  const connection = connectOAuthAccount(store, flow.provider, { connectionId: flow.connectionId, ...extra });
  remember({ ...flow, connection });
  return connection;
}

function flowFor(provider, body = {}) {
  const flow = body.flowId ? flows.get(body.flowId) : null;
  return flow && flow.provider === provider ? flow : null;
}

function broadcastCallback(flow) {
  if (typeof BroadcastChannel === "undefined") return;
  setTimeout(() => {
    try {
      const channel = new BroadcastChannel("oauth_callback");
      channel.postMessage({ code: `demo-code-${flow.flowId}`, state: flow.state, timestamp: Date.now() });
      channel.close();
    } catch (error) {
      console.debug("[demo] oauth callback broadcast failed", error);
    }
  }, CALLBACK_DELAY_MS);
}

function success(connection) {
  return { success: true, connection: sanitizeConnection(connection) };
}

function importResults(store, provider, accounts, emailOf) {
  const results = accounts.map((account, index) => {
    const email = emailOf(account) || null;
    const connection = connectOAuthAccount(store, provider, { email: email || undefined });
    return { index, ok: true, email: connection.email, connectionId: connection.id };
  });
  return { success: results.length, failed: 0, results };
}

export default function registerOAuth(router, { store }) {
  const handlers = {
    authorize: ({ url, params, body }) => {
      const flow = startFlow(params.provider, "authorization", body);
      const callback = new URL(`/dashboard/providers/${params.provider}`, url.origin);
      callback.search = new URLSearchParams({ demoOAuth: "1", code: `demo-code-${flow.flowId}`, state: flow.state }).toString();
      broadcastCallback(flow);
      return { authUrl: callback.toString(), state: flow.state, flowId: flow.flowId, codeChallengeMethod: "S256" };
    },
    "device-code": ({ params, body }) => {
      const flow = startFlow(params.provider, "device", body);
      // No verification URL: the modal shows the code and polling completes on its own.
      return { flowId: flow.flowId, user_code: `${randomToken(4)}-${randomToken(4)}`.toUpperCase(), expires_in: 600, interval: 2 };
    },
    poll: ({ params, body }) => {
      const flow = flowFor(params.provider, body);
      if (!flow) return { success: false, error: "expired_token", errorDescription: "Login session expired. Start again." };
      if (flow.polls + 1 < DEVICE_POLLS_BEFORE_SUCCESS) {
        remember({ ...flow, polls: flow.polls + 1 });
        return { success: false, error: "authorization_pending" };
      }
      return success(completeFlow(store, flow));
    },
    "poll-status": ({ params, body }) => {
      const flow = flowFor(params.provider, body);
      if (!flow) return { status: "error", error: "Login session expired" };
      completeFlow(store, flow);
      return { status: "done" };
    },
    "start-proxy": () => ({ success: true, serverSide: true }),
    "stop-proxy": () => ({ success: true }),
    cancel: () => ({ success: true }),
    exchange: ({ params, body }) => {
      const flow = flowFor(params.provider, body) || startFlow(params.provider, "authorization", body);
      return success(completeFlow(store, flow));
    },
    "import-token": ({ params, body }) => {
      // Raw JWTs arrive as a JSON string, auth.json files as objects.
      if (!body || (typeof body === "object" && !Object.keys(body).length)) return badRequest("Token is required");
      return success(connectOAuthAccount(store, params.provider));
    },
  };
  handlers["manual-code"] = handlers.exchange;

  router.post("/api/oauth/:provider/:action", (context) => {
    const handler = handlers[context.params.action];
    return handler ? handler(context) : badRequest(`Unsupported OAuth action: ${context.params.action}`);
  });

  router.get("/api/oauth/:provider/:action", ({ params }) => ({ provider: params.provider, action: params.action, status: "idle" }));

  router.post("/api/oauth/codex/bulk-import", ({ body = {} }) => {
    const accounts = Array.isArray(body.accounts) ? body.accounts : [];
    if (!accounts.length) return badRequest("No accounts provided");
    return importResults(store, "codex", accounts, (account) => account?.email || account?.tokens?.email);
  });

  router.post("/api/oauth/grok-cli/bulk-import", ({ body = {} }) => {
    const accounts = Array.isArray(body.accounts) ? body.accounts : [];
    if (!accounts.length) return badRequest("No accounts provided");
    return importResults(store, "grok-cli", accounts, (account) => account?.email);
  });

  router.get("/api/oauth/cursor/auto-import", () => ({ found: true, accessToken: "demo-cursor-access-token", machineId: "demo-machine" }));
  router.post("/api/oauth/cursor/import", ({ body = {} }) => {
    if (!body.accessToken) return badRequest("Access token is required");
    return success(connectOAuthAccount(store, "cursor"));
  });

  router.post("/api/oauth/gitlab/pat", ({ body = {} }) => {
    if (!body.token) return badRequest("Personal access token is required");
    return success(connectOAuthAccount(store, body.provider || "gitlab", { name: "balin-oakenshield (GitLab)" }));
  });

  router.post("/api/oauth/iflow/cookie", ({ body = {} }) => {
    if (!body.cookie) return badRequest("Cookie is required");
    return success(connectOAuthAccount(store, "iflow"));
  });

  router.get("/api/oauth/kiro/auto-import", () => ({ found: true, refreshToken: "demo-kiro-refresh-token", region: "us-east-1", authMethod: "builder-id" }));
  router.post("/api/oauth/kiro/import", ({ body = {} }) => {
    if (!body.refreshToken) return badRequest("Refresh token is required");
    return success(connectOAuthAccount(store, "kiro", { providerSpecificData: { authMethod: body.authMethod || "builder-id", region: body.region || "us-east-1" } }));
  });
  router.post("/api/oauth/kiro/import-cli-proxy", ({ body = {} }) => {
    if (!body.json) return badRequest("CLIProxyAPI JSON is required");
    return success(connectOAuthAccount(store, "kiro", { providerSpecificData: { authMethod: "social", region: "us-east-1" } }));
  });
  router.post("/api/oauth/kiro/api-key", ({ body = {} }) => {
    if (!body.apiKey) return badRequest("API key is required");
    return success(connectOAuthAccount(store, "kiro", { authType: "api_key", name: body.name || "Kiro API key" }));
  });
  router.post("/api/oauth/kiro/social-authorize", ({ url, body = {} }) => {
    const flow = startFlow("kiro", "social", body);
    const callback = new URL("/dashboard/providers/kiro", url.origin);
    callback.search = new URLSearchParams({ demoOAuth: "1", code: `demo-code-${flow.flowId}`, state: flow.state }).toString();
    return { authUrl: callback.toString(), state: flow.state, flowId: flow.flowId };
  });
  router.post("/api/oauth/kiro/social-exchange", ({ body = {} }) => {
    const flow = flowFor("kiro", body) || startFlow("kiro", "social", body);
    return success(completeFlow(store, flow, { providerSpecificData: { authMethod: "social", region: "us-east-1" } }));
  });
  router.post("/api/oauth/kiro/cancel", () => ({ success: true }));
}

