// MiniMax Code account provider (staged, guarded, closed-mock tested only).
//
// Ported from OmniRoute release/v3.8.55 (4265bb2ad5477450a07d3a43ea33a62c6c874878),
// open-sse/config/providers/registry/minimax-code/index.ts, with the device sign-in from
// src/lib/oauth/providers/minimax-code.ts and the gateway from
// open-sse/executors/minimaxCodeGateway.ts (MIT). The device-authorization client binding
// (`mcode-public`, scope `agent.default`, audience `agent-backend`) is published in
// MiniMax-AI/minimax-code packages/oauth-core; see docs/providers/minimax-code.mdx.
//
// This is a distinct identity from the `minimax` and `minimax-cn` API-key / Token Plan
// providers: it spends the subscription behind the signed-in MiniMax Code account and
// never shares a credential with them.
//
// DurinDoor differs from upstream in one deliberate way: the credential lives on the
// DurinDoor connection (encrypted like any OAuth connection). No local `~/.minimax` CLI
// profile is read or written.
//
// The gateway URL is an internal endpoint of the MiniMax Code app, not a documented public
// API, so dispatch is OFF until the connection sets providerSpecificData.enableSessionDispatch
// to the boolean true. Each connection opts in on its own.

// MiniMax Code signs in through a device code, not a browser cookie, so there is nothing for the
// extension or the cookie/cURL/HAR import to capture. Exported so the registration batch can see
// the contract is intentionally empty and skip extension/dashboard cookie wiring.
export const minimaxCodeCookieProfile = Object.freeze({
  notApplicable: true,
  reason: "OAuth device sign-in; the credential is an access/refresh token pair, not a cookie.",
  domains: Object.freeze([]),
  cookieNames: Object.freeze([]),
  validationProbe: null,
});

// Connection opt-in. Dispatch stays off until the connection sets this field to true.
export const minimaxCodeConnectionOptIn = Object.freeze({ providerSpecificData: "enableSessionDispatch" });

/** Ids the managed gateway accepts. The ids are the runtime's own, unprefixed. */
export const MINIMAX_CODE_MODELS = Object.freeze([
  { id: "MiniMax-M3.1-Flash", name: "MiniMax M3.1 Flash (Code)", contextLength: 1048576 },
  { id: "MiniMax-M3", name: "MiniMax M3 (Code)", contextLength: 512000 },
]);

export const MINIMAX_CODE_GATEWAY_URL = "https://agent.minimax.io/mavis/api/v1/llm/v1/messages";

export default {
  id: "minimax-code",
  alias: "mmcode",
  priority: 60,
  display: {
    name: "MiniMax Code (account sign-in, guarded)",
    icon: "memory",
    color: "#7C3AED",
    textIcon: "MC",
    website: "https://github.com/MiniMax-AI/minimax-code",
    notice: {
      text: "Staged and unverified against a live account. Signs in to a MiniMax account with the device flow and spends that account's MiniMax Code subscription through an internal MiniMax gateway. Off until the connection sets providerSpecificData.enableSessionDispatch to true; see the provider docs. Separate from the MiniMax API-key and Token Plan providers.",
    },
  },
  category: "oauth",
  authType: "oauth",
  authModes: ["oauth"],
  hasOAuth: true,
  transport: {
    baseUrl: MINIMAX_CODE_GATEWAY_URL,
    format: "claude",
    executor: "minimax-code",
    headers: { "anthropic-version": "2023-06-01", "User-Agent": "MiniMaxAgent" },
    auth: { combined: true, header: "Authorization", scheme: "bearer" },
  },
  // Account host per region. clientId/scope/audience live with the auth service.
  oauth: {
    clientId: "mcode-public",
    deviceCodeUrl: "https://account.minimax.io/oauth2/device/code",
    tokenUrl: "https://account.minimax.io/oauth2/token",
    refreshUrl: "https://account.minimax.io/oauth2/token",
    scope: "agent.default",
    codeChallengeMethod: "S256",
  },
  models: MINIMAX_CODE_MODELS.map((model) => ({ ...model })),
  serviceKinds: ["llm"],
};
