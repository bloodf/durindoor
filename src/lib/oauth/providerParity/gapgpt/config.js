// GapGPT (GapCode) sign-in constants, staged for #2034.
//
// Source: decolua/9router PR #3350, head 1f45c0e7b29bede1693ca0df613da957d67826bf
// (MIT), `open-sse/providers/registry/gapgpt.js` `oauth` block and
// `src/shared/components/OAuthModal.js` (fixed redirect). The provider registry
// row itself belongs to the upstream provider port; once it lands,
// `PROVIDER_OAUTH.gapgpt` must equal GAPGPT_OAUTH_CONFIG (the parity test pins
// these values so a drift is caught in one place).

export const GAPGPT_PROVIDER_ID = "gapgpt";

// GapCode is a Codex CLI fork. It reuses the Codex public client id and the
// Codex loopback redirect (localhost:1455/auth/callback), so it cannot share
// the port with a running Codex sign-in.
export const GAPGPT_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const GAPGPT_CALLBACK_HOST = "localhost";
export const GAPGPT_FIXED_PORT = 1455;
export const GAPGPT_CALLBACK_PATH = "/auth/callback";
export const GAPGPT_LOOPBACK_REDIRECT_URI =
  `http://${GAPGPT_CALLBACK_HOST}:${GAPGPT_FIXED_PORT}${GAPGPT_CALLBACK_PATH}`;

// Only these Host header values reach the callback handler. A browser that
// follows the provider redirect sends exactly one of them; anything else is a
// rebinding attempt or a stray request.
export const GAPGPT_CALLBACK_HOST_HEADERS = Object.freeze([
  `localhost:${GAPGPT_FIXED_PORT}`,
  `127.0.0.1:${GAPGPT_FIXED_PORT}`
]);

// The listener binds loopback only. Unlike the Codex proxy it ignores
// CODEX_OAUTH_CALLBACK_BIND_ALL: no container port-forward escape hatch.
export const GAPGPT_LISTEN_HOST = "127.0.0.1";

export const GAPGPT_OAUTH_CONFIG = Object.freeze({
  clientId: GAPGPT_CLIENT_ID,
  authorizeUrl: "https://gapgpt.app/oauth/cli",
  tokenUrl: "https://gapgpt.app/api/v1/oauth/cli/token",
  scope: "openid profile email offline_access api.connectors.read api.connectors.invoke",
  codeChallengeMethod: "S256",
  fixedPort: GAPGPT_FIXED_PORT,
  callbackPath: GAPGPT_CALLBACK_PATH,
  extraParams: Object.freeze({
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    originator: "codex_cli_rs"
  }),
  refresh: Object.freeze({ encoding: "form" })
});

// Hosts the staged provider may call. The exchange and refresh refuse any
// other token URL, so a config override cannot redirect a code or a refresh
// token to a third party.
export const GAPGPT_TOKEN_ORIGIN = "https://gapgpt.app";

/** True when `provider` is the GapGPT source id. `gapcode` is not an alias. */
export function isGapgptProvider(provider) {
  return provider === GAPGPT_PROVIDER_ID;
}
