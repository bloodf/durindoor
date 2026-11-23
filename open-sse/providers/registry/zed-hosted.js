// Staged Zed-hosted inference provider (opt-in; not registered).
//
// Ported from OmniRoute release/v3.8.55 (4265bb2ad5477450a07d3a43ea33a62c6c874878),
// open-sse/config/providers/registry/zed-hosted/index.ts (MIT). Sign-in lives in
// src/lib/oauth/zedHostedProvider.js, the executor in open-sse/executors/zed-hosted.js.
// This is distinct from the hidden `zed` IDE key-import entry, which stays untouched.
// See docs/providers/zed-hosted.mdx and internal/docs/zed-hosted-contract.md.

// Sign-in is Zed's native-app flow (RSA keypair + loopback callback), not a browser
// cookie, so there is nothing to capture. Exported so the registration batch can see
// the contract is intentionally empty and skip extension/dashboard cookie wiring.
export const zedHostedCookieProfile = Object.freeze({
  notApplicable: true,
  domains: Object.freeze([]),
  cookieNames: Object.freeze([]),
  validationProbe: null,
});

// Connection opt-in. Dispatch and discovery stay off until the connection sets
// providerSpecificData.enableSessionDispatch === true.
export const zedHostedConnectionOptIn = Object.freeze({ providerSpecificData: "enableSessionDispatch" });

export default {
  id: "zed-hosted",
  alias: "zdh",
  priority: 61,
  display: {
    name: "Zed Hosted Models (opt-in)",
    icon: "code",
    color: "#084CCF",
    textIcon: "ZH",
    website: "https://zed.dev",
    notice: {
      text: "Opt-in. Signs in to a Zed account through Zed's native-app flow and re-serves its hosted-model plan through this gateway. Off until the connection sets providerSpecificData.enableSessionDispatch to true. Check Zed's terms first; see the provider docs.",
    },
  },
  category: "oauth",
  authType: "oauth",
  hasOAuth: true,
  authHint: "Sign in to Zed in your browser, then paste the 127.0.0.1 callback URL if it does not complete automatically.",
  transport: {
    baseUrl: "https://cloud.zed.dev/completions",
    format: "openai",
    executor: "zed-hosted",
    authType: "oauth",
    forceStream: true,
    timeoutMs: 120000,
  },
  // The hosted catalog changes often and is fetched live per connection after the
  // LLM-token exchange; nothing is seeded here.
  passthroughModels: true,
  models: [],
};
