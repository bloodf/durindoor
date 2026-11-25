// ZCode local app-server provider (staged, unverified against a live runtime).
// Session flow follows OmniRoute release/v3.8.55
// (4265bb2ad5477450a07d3a43ea33a62c6c874878),
// open-sse/config/providers/registry/zcode/index.ts and open-sse/executors/zcode.ts.
// The wire protocol is the first-party V4 stdio NDJSON contract documented in
// internal/docs/zcode-v4-compatibility-1252.md, not the binary fixture upstream uses.

// ZCode authenticates through the user's local ZCode profile, so there is no
// browser cookie to capture. Exported so the registration batch can see the
// contract is intentionally empty and skip extension/dashboard cookie wiring.
export const zcodeCookieProfile = Object.freeze({
  notApplicable: true,
  domains: Object.freeze([]),
  cookieNames: Object.freeze([]),
  validationProbe: null,
});

// Connection opt-in. Dispatch stays off until the connection sets
// providerSpecificData.enableSessionDispatch === true.
export const zcodeConnectionOptIn = Object.freeze({ providerSpecificData: "enableSessionDispatch" });

export default {
  id: "zcode",
  alias: "zc",
  priority: 60,
  display: {
    name: "ZCode (local app-server, unverified)",
    icon: "code",
    color: "#2563EB",
    textIcon: "ZC",
    website: "https://github.com/zai-org/ZCode",
    notice: {
      text: "Unverified and staged. Drives a local ZCode app-server over its V4 stdio protocol with tools disabled, and re-serves that profile's Z.ai plan through this gateway. Off until the connection sets providerSpecificData.enableSessionDispatch to true; see the provider docs.",
    },
  },
  category: "free",
  noAuth: true,
  transport: {
    baseUrl: "zcode://app-server/stdio",
    format: "openai",
    executor: "zcode",
    noAuth: true,
  },
  // OmniRoute metadata only; which models a profile can use is not discoverable
  // over the documented V4 stdio interface, so other ids pass through.
  passthroughModels: true,
  models: [
    { id: "glm-5.3", name: "GLM 5.3 (ZCode)" },
    { id: "glm-5.2", name: "GLM 5.2 (ZCode)", supportsReasoning: true },
  ],
  serviceKinds: ["llm"],
};
