import { describe, expect, it } from "vitest";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { parsePairing } from "../../extensions/provider-cookie-capture/capture.js";
import { PAIRING_HEADER, PROVIDERS as EXTENSION_PROVIDERS } from "../../extensions/provider-cookie-capture/providers.js";
import { WEB_COOKIE_PROVIDERS } from "../../src/shared/constants/providers.js";
import { buildImportedCookieHeader, describeCookieImportContract, getCookieImportContract } from "../../src/lib/providers/cookieImport/contract.js";
import { buildImportCandidates } from "../../src/shared/utils/cookieImportParser.js";

const session = "__Secure-next-auth.session-token";
const profiles = [
  ["chatgpt-web", "https://chatgpt.com", [session], true, [`${session}.`]],
  ["perplexity-web", "https://www.perplexity.ai", [session], true, [`${session}.`]],
  ["grok-web", "https://grok.com", ["sso"], true],
  ["muse-spark-web", "https://www.meta.ai", ["ecto_1_sess"], true],
  ["adapta-web", "https://clerk.agent.adapta.one", ["__client"], false],
  ["yuanbao-web", "https://yuanbao.tencent.com", ["hy_user", "hy_token"], true],
  ["chatgpt-web-codex", "https://chatgpt.com", [session], true, [`${session}.`]],
  ["claude-web", "https://claude.ai", ["sessionKey"], true],
  ["gemini-web", "https://gemini.google.com", ["__Secure-1PSID", "__Secure-1PSIDTS"], true],
  ["doubao-web", "https://www.dola.com", ["sessionid", "s_v_web_id"], true],
  ["zai-web", "https://chat.z.ai", ["token"], true],
  ["chatplayground", "https://app.chatplayground.ai", ["__client", "__session"], true],
  ["lmarena", "https://arena.ai", ["arena-auth-prod-v1"], true, ["arena-auth-prod-v1."]],
  ["maxai", "https://www.maxai.co", ["access_token", "device_id", "user_id"], true],
  ["promptql", "https://prompt.ql.app", ["__Host-next-auth.csrf-token", "next-auth.session-token"], true],
  ["notion-web", "https://app.notion.com", ["token_v2"], true],
  ["notrack-web", "https://notrack.ai", ["uid", "si_usr_id", "si_ses_id"], true],
  ["tencent-aistudio-web", "https://aistudio.tencent.ai", ["sessionid"], true],
  ["blackbox-web", "https://app.blackbox.ai", ["next-auth.session-token"], true],
  ["conol-web", "https://conol.ai", ["__Secure-better-auth.session_token"], true],
];
// Profiles of providers outside the web-cookie category whose credential is a localStorage item.
const localStorageProfiles = [
  ["tinycms-web", "https://site.tinycms.xyz", ["app-config-uuid"]],
];
const manual = [
  "copilot-web", "copilot-m365-web", "huggingchat", "kimi-web",
  "suno", "t3-web", "udio", "zenmux-free",
];

describe("web cookie import profiles", () => {
  it("accounts for the complete web-cookie registry and extension allowlist", () => {
    expect(REGISTRY.filter((entry) => entry.category === "webCookie").map((entry) => entry.id).sort())
      .toEqual([...profiles.map(([id]) => id), ...manual].sort());
    expect(Object.keys(EXTENSION_PROVIDERS).sort())
      .toEqual([...profiles.filter(([, , , capture]) => capture).map(([id]) => id), ...localStorageProfiles.map(([id]) => id)].sort());
  });

  it.each(profiles)("filters credentials for %s", (id, origin, cookieNames, extensionCapture, cookiePrefixes = []) => {
    const contract = getCookieImportContract(id);
    const description = { origin, cookieNames, cookiePrefixes };
    expect(describeCookieImportContract(contract)).toEqual(extensionCapture ? description : { ...description, extensionCapture: false });
    expect(WEB_COOKIE_PROVIDERS[id].cookieImport).toMatchObject({ ...description, extensionCapture });
    if (extensionCapture) expect(EXTENSION_PROVIDERS[id]).toMatchObject(description);

    const cookies = cookieNames.map((name) => ({ name, value: "synthetic", secure: true, domain: new URL(origin).hostname }));
    const noise = { name: "cf_clearance", value: "synthetic" };
    const wrongOrigin = id === "adapta-web" ? "https://agent.adapta.one" : `${origin}.example`;
    const approved = { origin, url: `${origin}/request`, cookies: [...cookies, noise] };
    const other = { ...approved, origin: wrongOrigin, url: `${wrongOrigin}/request` };
    expect(buildImportCandidates({ kind: "curl", parsed: other }, contract).ok).toBe(false);
    expect(buildImportCandidates({ kind: "har", parsed: { entries: [other, approved] } }, contract))
      .toMatchObject({ ok: true, candidates: [{ origin, cookies, dropped: [noise.name] }] });

    expect(buildImportedCookieHeader(contract, cookies)).toEqual({
      ok: true, header: cookieNames.map((name) => `${name}=synthetic`).join("; "),
    });
    expect(buildImportedCookieHeader(contract, cookies.slice(1)).ok).toBe(false);
    expect(buildImportedCookieHeader(contract, [...cookies, noise]).ok).toBe(false);
    expect(buildImportedCookieHeader(contract, [{ ...cookies[0], domain: "other.example" }, ...cookies.slice(1)]).ok).toBe(false);
  });

  it("requires both Yuanbao names and keeps the Clerk profile out of extension capture", () => {
    const now = Date.UTC(2026, 0, 1);
    const pairing = (provider, contract) => JSON.stringify({
      provider, contract, header: PAIRING_HEADER, token: `ddpair_${"A".repeat(43)}`,
      expiresAt: new Date(now + 60_000).toISOString(), action: "create", name: "Example",
      importUrl: "https://dashboard.example/api/providers/cookie-import",
    });
    const yuanbao = describeCookieImportContract(getCookieImportContract("yuanbao-web"));
    expect(parsePairing(pairing("yuanbao-web", yuanbao), now))
      .toMatchObject({ ok: true, plan: { cookieNames: ["hy_user", "hy_token"] } });
    expect(parsePairing(pairing("yuanbao-web", { ...yuanbao, cookieNames: ["hy_token"] }), now).ok).toBe(false);
    expect(parsePairing(pairing("yuanbao-web", { ...yuanbao, origin: "https://tencent.com" }), now).ok).toBe(false);

    const adapta = describeCookieImportContract(getCookieImportContract("adapta-web"));
    expect(parsePairing(pairing("adapta-web", adapta), now)).toMatchObject({ code: "unsupported_provider" });
  });

  it.each(manual)("keeps %s on its existing credential path", (id) => {
    expect(getCookieImportContract(id)).toBeNull();
    expect(WEB_COOKIE_PROVIDERS[id].cookieImport).toBeUndefined();
    expect(EXTENSION_PROVIDERS[id]).toBeUndefined();
  });

  it.each(["chatgpt-web", "perplexity-web"])("composes contiguous chunks for %s", (id) => {
    const contract = getCookieImportContract(id);
    const part = (suffix) => ({ name: session + suffix, value: "synthetic" });
    expect(buildImportedCookieHeader(contract, [part(".1")]).ok).toBe(false);
    expect(buildImportedCookieHeader(contract, [part(".wildcard")]).ok).toBe(false);
    expect(buildImportedCookieHeader(contract, [part(""), part(".1"), part(".0")]))
      .toEqual({ ok: true, header: `${session}.0=synthetic; ${session}.1=synthetic` });
  });
});
