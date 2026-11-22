// Staged Freebuff provider, ported from OmniRoute release/v3.8.55
// (4265bb2ad5477450a07d3a43ea33a62c6c874878), MIT:
//   open-sse/config/providers/registry/freebuff/index.ts
//   open-sse/executors/freebuff.ts
//   src/lib/oauth/providers/freebuff.ts (+ FREEBUFF_CONFIG in src/lib/oauth/constants/oauth.ts)
//
// Freebuff is the free, ad-supported Codebuff product. Its CLI login produces a
// device-session `authToken`, which is NOT a paid `cb_...` Codebuff API key, so
// this entry is a separate identity from any Codebuff connection and never
// reads or writes one. See internal/docs/freebuff-provider-contract.md and
// docs/providers/freebuff.mdx.
//
// The chat flow is a reverse-engineered client of Freebuff service endpoints,
// not a documented third-party API. Dispatch is therefore off unless the
// connection sets providerSpecificData.enableSessionDispatch === true.

import {
  FREEBUFF_API_BASE,
  FREEBUFF_MODELS,
  FREEBUFF_OAUTH,
  FREEBUFF_OPT_IN_KEY,
} from "../../config/freebuff.js";

export { freebuffConnectionOptIn, freebuffCookieProfile, FREEBUFF_AGENT_BY_MODEL, FREEBUFF_API_BASE, FREEBUFF_MODELS, FREEBUFF_OAUTH, FREEBUFF_OPT_IN_KEY } from "../../config/freebuff.js";

export default {
  id: "freebuff",
  alias: "fb",
  priority: 62,
  display: {
    name: "Freebuff (session, opt-in)",
    icon: "bolt",
    color: "#10B981",
    textIcon: "FB",
    website: "https://freebuff.com",
    notice: {
      text: "Unofficial. Uses a Freebuff device-session login (not a paid Codebuff key) against undocumented Freebuff service endpoints. Off until the connection sets providerSpecificData.enableSessionDispatch to true; see the provider docs.",
    },
  },
  category: "oauth",
  authModes: ["oauth", "apikey"],
  hasOAuth: true,
  hasFree: true,
  transport: {
    baseUrl: FREEBUFF_API_BASE,
    format: "openai",
    executor: "freebuff",
  },
  oauth: { ...FREEBUFF_OAUTH },
  models: FREEBUFF_MODELS.map((model) => ({ ...model })),
  serviceKinds: ["llm"],
};
