// Ported from OmniRoute release/v3.8.55
// (4265bb2ad5477450a07d3a43ea33a62c6c874878),
// open-sse/config/providers/registry/notrack-web/index.ts.
export const notrackWebCookieProfile = {
  domains: ["notrack.ai"],
  cookieNames: ["uid", "si_usr_id", "si_ses_id", "nt_session"],
  cookiePrefixes: [],
  validationProbe: { url: "https://notrack.ai/api/dispatch", method: "POST" },
};

export default {
  id: "notrack-web",
  alias: "ntw",
  display: { name: "NoTrack Web", icon: "chat", color: "#2563EB", textIcon: "NT", website: "https://notrack.ai" },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste the Cookie header from a notrack.ai chat request (uid, si_usr_id, si_ses_id; nt_session is optional).",
  webLogin: {
    startUrl: "https://notrack.ai/",
    origin: "https://notrack.ai",
    allowedHosts: [],
    cookieNames: notrackWebCookieProfile.cookieNames,
    readyProbe: { url: "https://notrack.ai/", method: "GET", okStatus: [200] },
  },
  serviceKinds: ["llm"],
  transport: { baseUrl: "https://notrack.ai/api/dispatch", format: "openai", executor: "notrack-web", authType: "cookie" },
  models: [{ id: "notrack-c", name: "NoTrack C", aliases: ["C", "notrack", "ntw"] }],
};
