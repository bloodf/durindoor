// #2034 staged Firefly web UI: config, preflight, profile and staging checks.
// All fixtures are synthetic; no browser is launched and nothing is contacted.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import definition, { ADOBE_FIREFLY_WEB_ID, ADOBE_FIREFLY_WEB_ORIGIN } from "../../open-sse/providers/private/adobe-firefly-web.js";
import { STAGED_PROVIDERS } from "../../open-sse/providers/staged.js";
import manifest from "../../open-sse/executors/staged.json";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { getImageAdapter } from "../../open-sse/handlers/imageProviders/index.js";
import { getVideoGenerationAdapter } from "../../open-sse/handlers/videoProviders/index.js";
import { parseFireflyWebUiConfig, parseLocator, prepareFireflyWebUiRequest } from "../../open-sse/services/fireflyWebUi/config.js";
import { PROFILE_MARKER, initializeProfile, profileDir, resolveProfile } from "../../open-sse/services/fireflyWebUi/profile.js";
import { detectArtifact } from "../../open-sse/services/fireflyWebUi/artifact.js";
import { HTML, JPEG, MP4, PNG, WEBM, syntheticCredentials, syntheticMapping } from "../fixtures/fireflyWebUi/fakeBrowser.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HANDLE = "0123456789abcdef0123456789abcdef";
const config = (overrides) => parseFireflyWebUiConfig(syntheticCredentials({ profileHandle: HANDLE, ...overrides }));
const status = (fn) => {
  try {
    fn();
  } catch (error) {
    return [error.status, error.outcome, error.message];
  }
  return null;
};

describe("staged registration", () => {
  it("is one canonical id with no alias, authType none, image and video, and staged only", () => {
    expect(definition).toMatchObject({ id: "adobe-firefly-web", authType: "none", serviceKinds: ["image", "video"], models: [] });
    expect(definition.alias).toBeUndefined();
    expect(definition.uiAlias).toBeUndefined();
    expect(ADOBE_FIREFLY_WEB_ORIGIN).toBe("https://firefly.adobe.com");
    expect(STAGED_PROVIDERS[ADOBE_FIREFLY_WEB_ID]).toMatchObject({ staged: true, docs: "docs/providers/adobe-firefly-web.md" });
    expect(manifest.modules.filter(({ provider }) => provider === ADOBE_FIREFLY_WEB_ID).map(({ module }) => module))
      .toEqual(["open-sse/providers/private/adobe-firefly-web.js"]);
    const ids = new Set(REGISTRY.flatMap(({ id, alias, aliases }) => [id, alias, ...(aliases || [])]));
    for (const id of ["adobe-firefly-web", "adobe-firefly", "firefly"]) expect(ids.has(id), id).toBe(false);
    expect(getImageAdapter(ADOBE_FIREFLY_WEB_ID)).toBeNull();
    expect(getVideoGenerationAdapter(ADOBE_FIREFLY_WEB_ID)).toBeNull();
  });

  it("ships no default Adobe selectors and imports no shared or stealth browser code", () => {
    const dir = path.join(root, "open-sse/services/fireflyWebUi");
    const sources = [
      ...fs.readdirSync(dir).map((name) => fs.readFileSync(path.join(dir, name), "utf8")),
      fs.readFileSync(path.join(root, "open-sse/providers/private/adobe-firefly-web.js"), "utf8"),
      fs.readFileSync(path.join(root, "open-sse/handlers/imageProviders/adobe-firefly-web.js"), "utf8"),
      fs.readFileSync(path.join(root, "open-sse/handlers/videoProviders/adobe-firefly-web.js"), "utf8"),
    ].join("\n").replace(/^\s*(?:\/\/|\*|\/\*\*).*$/gm, "");
    const imports = [...sources.matchAll(/(?:from|import\()\s*["']([^"']+)["']/g)].map((match) => match[1]);
    for (const banned of ["browserPool", "obscura", "cloak", "stealth", "webLoginSession", "puppeteer"]) {
      expect(imports.some((specifier) => specifier.toLowerCase().includes(banned.toLowerCase())), banned).toBe(false);
    }
    expect(sources).not.toMatch(/resolvePlainBrowserLaunchOptions|userAgent|addInitScript\(|addCookies\(|storageState\(|\.cookies\(|evaluate\(|click\([^)]*force|setExtraHTTPHeaders/);
    // No built-in Adobe labels: only the docs' semantic names, which are never selectors.
    expect(sources).not.toMatch(/name:\s*["'](Generate|Prompt|Model|Download)["']/);
  });

  it("documents the staged provider as staged and unavailable", () => {
    const doc = fs.readFileSync(path.join(root, "docs/providers/adobe-firefly-web.md"), "utf8");
    expect(doc).toMatch(/staged/i);
    expect(doc).toMatch(/unavailable/i);
    expect(doc).toMatch(/^status:\s*unreleased\s*$/m);
    expect(doc).not.toMatch(/internal\/docs/);
  });
});

describe("config guard", () => {
  it("accepts the synthetic operator-validated config", () => {
    const parsed = config();
    expect(parsed.enabled).toBe(true);
    expect(parsed.mapping.validatedBy).toBe("operator");
    expect(parsed.mapping.locators.identityAttr).toBe("data-synthetic-id");
    expect(parsed.limits.pollIntervalMs).toBe(50);
    expect(parsed.modelMap["synthetic-video"]).toEqual({ label: "Synthetic Video Label", kind: "video" });
  });

  it.each([
    ["missing", { providerSpecificData: {} }],
    ["truthy non-true", syntheticCredentials({ profileHandle: HANDLE, config: { enabled: "true" } })],
    ["false", syntheticCredentials({ profileHandle: HANDLE, config: { enabled: false } })],
  ])("is disabled unless enabled is exactly true (%s)", (_name, credentials) => {
    expect(status(() => parseFireflyWebUiConfig({ connectionId: "conn-a", ...credentials }))?.slice(0, 2)).toEqual([403, "disabled"]);
  });

  it.each(["", "short", "0123456789ABCDEF0123456789ABCDEF", "../../0123456789abcdef0123456789", `${HANDLE}0`])(
    "refuses a non-server profile handle %j", (profileHandle) => {
      expect(status(() => config({ profileHandle }))?.[0]).toBe(409);
    },
  );

  it.each([
    ["apiKey", { apiKey: "synthetic-key" }],
    ["accessToken", { accessToken: "synthetic-token" }],
    ["cookie", { cookie: "a=b" }],
    ["bearer in providerSpecificData", { providerSpecificData: { bearer: "synthetic" } }],
    ["cookie in providerSpecificData", { providerSpecificData: { sessionCookie: "a=b" } }],
  ])("refuses a supplied %s", (_name, extra) => {
    const credentials = syntheticCredentials({ profileHandle: HANDLE });
    const merged = { ...credentials, ...extra, providerSpecificData: { ...credentials.providerSpecificData, ...extra.providerSpecificData } };
    expect(status(() => parseFireflyWebUiConfig(merged))?.[0]).toBe(400);
  });

  it("needs operator validation and every actor/observer locator", () => {
    expect(status(() => config({ mapping: null }))?.[0]).toBe(400);
    expect(status(() => config({ mapping: { ...syntheticMapping(), validatedBy: "tool" } }))?.[0]).toBe(400);
    expect(status(() => config({ mapping: { ...syntheticMapping(), validatedAt: "yesterday" } }))?.[0]).toBe(400);
    for (const key of ["prompt", "submit", "modelPicker", "modelOptionRole", "resultItem", "resultReady", "download", "stopMarkers"]) {
      const mapping = syntheticMapping();
      delete mapping.locators[key];
      expect(status(() => config({ mapping }))?.[0], key).toBe(400);
    }
    expect(status(() => config({ mapping: syntheticMapping({ locators: { stopMarkers: [] } }) }))?.[0]).toBe(400);
  });

  it("allows only role/name or label locators", () => {
    expect(parseLocator({ role: "button", name: "Synthetic" }, "x")).toEqual({ role: "button", name: "Synthetic", exact: true });
    expect(parseLocator({ label: "Synthetic" }, "x")).toEqual({ label: "Synthetic", exact: true });
    for (const bad of [{ css: ".x" }, { xpath: "//a" }, { role: "button", selector: "x" }, { role: "script" }, { role: "button", name: "" },
      { role: "button", js: "1" }, { label: "x", evaluate: "1" }, "button", { role: "button", exact: "yes" }]) {
      expect(() => parseLocator(bad, "x"), JSON.stringify(bad)).toThrow();
    }
    expect(status(() => config({ mapping: syntheticMapping({ locators: { identityAttr: "onclick" } }) }))?.[0]).toBe(400);
    expect(status(() => config({ mapping: syntheticMapping({ locators: { modelOptionRole: "textbox" } }) }))?.[0]).toBe(400);
  });

  it("bounds limits, start paths and the model map", () => {
    expect(status(() => config({ limits: { timeoutMs: 1 } }))?.[0]).toBe(400);
    expect(status(() => config({ limits: { maxImageBytes: 10 ** 12 } }))?.[0]).toBe(400);
    expect(status(() => config({ limits: { surprise: 1 } }))?.[0]).toBe(400);
    for (const bad of ["https://evil.invalid/", "//evil.invalid", "/a/../b", "relative"]) {
      expect(status(() => config({ mapping: syntheticMapping({ startPaths: { image: bad } }) }))?.[0], bad).toBe(400);
    }
    expect(status(() => config({ modelMap: {} }))?.[0]).toBe(400);
    expect(status(() => config({ modelMap: { "synthetic-x": { label: "X", kind: "audio" } } }))?.[0]).toBe(400);
    expect(status(() => config({ modelMap: { "Bad Id": { label: "X", kind: "image" } } }))?.[0]).toBe(400);
    expect(status(() => config({ config: { selectors: {} } }))?.[0]).toBe(400);
  });
});

describe("request preflight", () => {
  const parsed = () => config();
  const prepare = (kind, model, body) => () => prepareFireflyWebUiRequest(parsed(), { kind, model, body });

  it("accepts configured image and video models with the declared b64_json default", () => {
    expect(prepare("image", "synthetic-image", { prompt: "a synthetic fox" })()).toMatchObject({ kind: "image", label: "Synthetic Image Label", responseFormat: "b64_json" });
    expect(prepare("video", "synthetic-video", { prompt: "a synthetic river", n: 1, response_format: "b64_json" })()).toMatchObject({ kind: "video", label: "Synthetic Video Label" });
  });

  it.each([
    ["unknown model", "image", "other", { prompt: "p" }],
    ["video model on image route", "image", "synthetic-video", { prompt: "p" }],
    ["image model on video route", "video", "synthetic-image", { prompt: "p" }],
    ["url format", "image", "synthetic-image", { prompt: "p", response_format: "url" }],
    ["url format for video", "video", "synthetic-video", { prompt: "p", response_format: "url" }],
    ["binary format", "image", "synthetic-image", { prompt: "p", response_format: "binary" }],
    ["n 2", "image", "synthetic-image", { prompt: "p", n: 2 }],
    ["empty prompt", "image", "synthetic-image", { prompt: "  " }],
    ["long prompt", "image", "synthetic-image", { prompt: "x".repeat(2001) }],
    ["size", "image", "synthetic-image", { prompt: "p", size: "1024x1024" }],
    ["seed", "video", "synthetic-video", { prompt: "p", seed: 1 }],
    ["seconds", "video", "synthetic-video", { prompt: "p", seconds: 5 }],
    ["reference image", "image", "synthetic-image", { prompt: "p", image: "data:," }],
    ["edit mask", "image", "synthetic-image", { prompt: "p", mask: "data:," }],
    ["stream", "image", "synthetic-image", { prompt: "p", stream: true }],
    ["config override", "image", "synthetic-image", { prompt: "p", fireflyWebUi: { enabled: true } }],
    ["mapping override", "image", "synthetic-image", { prompt: "p", mapping: {} }],
    ["profile override", "image", "synthetic-image", { prompt: "p", profileHandle: HANDLE }],
    ["origin override", "video", "synthetic-video", { prompt: "p", origin: "https://evil.invalid" }],
    ["chat body", "image", "synthetic-image", { prompt: "p", messages: [] }],
  ])("refuses %s with 400", (_name, kind, model, body) => {
    expect(status(prepare(kind, model, body))?.[0]).toBe(400);
  });
});

describe("artifact type checks", () => {
  it("accepts only the kind's own magic bytes", () => {
    expect(detectArtifact("image", PNG)).toEqual({ mime: "image/png", format: "png" });
    expect(detectArtifact("image", JPEG)).toEqual({ mime: "image/jpeg", format: "jpeg" });
    expect(detectArtifact("video", MP4)).toEqual({ mime: "video/mp4", format: "mp4" });
    expect(detectArtifact("video", WEBM)).toEqual({ mime: "video/webm", format: "webm" });
    expect(detectArtifact("image", MP4)).toBeNull();
    expect(detectArtifact("video", PNG)).toBeNull();
    expect(detectArtifact("image", HTML)).toBeNull();
    expect(detectArtifact("image", Buffer.alloc(4))).toBeNull();
  });
});

describe("private profiles", () => {
  let dataDir;
  beforeEach(() => { dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "firefly-web-config-")); });
  afterEach(() => fs.rmSync(dataDir, { recursive: true, force: true }));

  it("creates a server handle bound to its connection under the provider root", () => {
    const { profileHandle } = initializeProfile({ dataDir, connectionId: "conn-a" });
    expect(profileHandle).toMatch(/^[0-9a-f]{32}$/);
    const dir = resolveProfile({ dataDir, connectionId: "conn-a", profileHandle });
    expect(dir).toBe(path.join(dataDir, "browser-profiles", "adobe-firefly-web", "conn-a", profileHandle));
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
    const marker = JSON.parse(fs.readFileSync(path.join(dir, PROFILE_MARKER), "utf8"));
    expect(marker).toMatchObject({ provider: "adobe-firefly-web", connectionId: "conn-a", profileHandle });
  });

  it("never replaces an existing handle", () => {
    const { profileHandle } = initializeProfile({ dataDir, connectionId: "conn-a" });
    expect(status(() => initializeProfile({ dataDir, connectionId: "conn-a", existingHandle: profileHandle }))?.[0]).toBe(409);
  });

  it("refuses traversal, foreign, tampered, changed and symlinked profiles", () => {
    const a = initializeProfile({ dataDir, connectionId: "conn-a" }).profileHandle;
    const b = initializeProfile({ dataDir, connectionId: "conn-b" }).profileHandle;
    for (const connectionId of ["..", "../conn-a", "conn/a", "", ".hidden"]) {
      expect(status(() => resolveProfile({ dataDir, connectionId, profileHandle: a }))?.[0], connectionId).toBe(400);
    }
    // Another connection's handle does not resolve here.
    expect(status(() => resolveProfile({ dataDir, connectionId: "conn-a", profileHandle: b }))?.[0]).toBe(409);
    // A changed (never created) handle.
    expect(status(() => resolveProfile({ dataDir, connectionId: "conn-a", profileHandle: HANDLE }))?.[0]).toBe(409);
    // A tampered marker.
    const markerFile = path.join(profileDir(dataDir, "conn-a", a), PROFILE_MARKER);
    fs.writeFileSync(markerFile, JSON.stringify({ provider: "adobe-firefly-web", connectionId: "conn-b", profileHandle: a }));
    expect(status(() => resolveProfile({ dataDir, connectionId: "conn-a", profileHandle: a }))?.[0]).toBe(409);
    fs.writeFileSync(markerFile, "not json");
    expect(status(() => resolveProfile({ dataDir, connectionId: "conn-a", profileHandle: a }))?.[0]).toBe(409);
    // A symlinked profile pointing at another connection's directory.
    const linked = profileDir(dataDir, "conn-c", HANDLE);
    fs.mkdirSync(path.dirname(linked), { recursive: true });
    fs.symlinkSync(profileDir(dataDir, "conn-b", b), linked);
    expect(status(() => resolveProfile({ dataDir, connectionId: "conn-c", profileHandle: HANDLE }))?.[0]).toBe(409);
    // Nothing was deleted.
    expect(fs.existsSync(profileDir(dataDir, "conn-a", a))).toBe(true);
    expect(fs.existsSync(profileDir(dataDir, "conn-b", b))).toBe(true);
  });

  it("refuses a relative data directory", () => {
    expect(status(() => initializeProfile({ dataDir: "relative", connectionId: "conn-a" }))?.[0]).toBe(500);
  });
});
