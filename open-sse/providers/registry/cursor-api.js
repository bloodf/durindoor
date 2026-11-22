// Cursor API-key connection (staged). Ported from OmniRoute release/v3.8.55
// (4265bb2ad5477450a07d3a43ea33a62c6c874878),
// open-sse/config/providers/registry/cursor/index.ts (`cursor_apiProvider`) and
// open-sse/services/cursorApiKeyAuth.ts.
//
// Same wire protocol, catalog and request path as the existing `cursor` OAuth
// provider, but the connection holds a Cursor user API key (`crsr_...`, minted at
// https://cursor.com/dashboard/api) that the executor exchanges for a one-hour
// session token. It is a separate identity so API-key and IDE-session
// connections never share renewal, quota or dashboard semantics.
import cursor from "./cursor.js";

// A user API key is a bearer secret, not a browser session, so there is no
// cookie to capture. Exported so the registration batch can see the contract is
// intentionally empty and skip extension/dashboard cookie wiring.
export const cursorApiCookieProfile = Object.freeze({
  notApplicable: true,
  domains: Object.freeze([]),
  cookieNames: Object.freeze([]),
  validationProbe: null,
});

// Connection opt-in. Dispatch stays off until the connection sets
// providerSpecificData.enableSessionDispatch === true.
export const cursorApiConnectionOptIn = Object.freeze({ providerSpecificData: "enableSessionDispatch" });

export default {
  id: "cursor-api",
  alias: "cua",
  uiAlias: "cua",
  priority: 55,
  display: {
    name: "Cursor API (key exchange, unverified)",
    icon: "edit_note",
    color: "#00D4AA",
    textIcon: "CA",
    website: "https://cursor.com/dashboard/api",
    notice: {
      text: "Unverified and staged. Exchanges a Cursor user API key (crsr_...) for a session token and re-serves that account's Cursor plan through this gateway. Off until the connection sets providerSpecificData.enableSessionDispatch to true; see the provider docs.",
      apiKeyUrl: "https://cursor.com/dashboard/api",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    // Same endpoint, path, format and headers as `cursor`; only auth differs.
    ...cursor.transport,
    authType: "apikey",
    authHeader: "bearer",
    executor: "cursor-api",
  },
  // The IDE entry's static catalog doubles as the fallback when the live
  // account catalog is unavailable.
  models: cursor.models,
  passthroughModels: true,
  serviceKinds: ["llm"],
};
