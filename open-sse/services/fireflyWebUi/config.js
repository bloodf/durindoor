// Connection config and request preflight for the staged Firefly web UI flow
// (#2034). Everything here runs before any browser launch, and every failure
// is a plain status-tagged error that never reaches the browser.
//
// The only config source is the stored connection's
// providerSpecificData.fireflyWebUi. A request body can never supply or
// override any of it: only `model`, `prompt`, `n` (1) and `response_format`
// are read from the body, and any other field is refused.
//
// There are no default Adobe selectors. The mapping is the operator's own,
// validated by them against their current Firefly UI (validatedBy "operator"
// plus validatedAt); this module only checks its shape.
import { isBoolean, isNumber, isRecord, isString } from "../../../src/shared/utils/typeChecks.js";

export const FIREFLY_WEB_UI_KEY = "fireflyWebUi";
export const PROFILE_HANDLE_PATTERN = /^[0-9a-f]{32}$/;
export const RESPONSE_FORMAT = "b64_json";
export const KINDS = Object.freeze(["image", "video"]);

// Accessible roles an operator may map. Locators are role/name or label only:
// no CSS, XPath, text engines, script or evaluation.
export const LOCATOR_ROLES = Object.freeze([
  "alert", "alertdialog", "article", "button", "checkbox", "combobox", "dialog", "figure", "gridcell", "group",
  "heading", "img", "link", "listbox", "listitem", "menuitem", "menuitemradio", "option", "progressbar",
  "radio", "region", "row", "status", "tab", "textbox",
]);
const OPTION_ROLES = new Set(["option", "menuitem", "menuitemradio", "radio"]);
const IDENTITY_ATTR = /^(?:id|data-[a-z0-9]+(?:-[a-z0-9]+)*)$/;
const PUBLIC_MODEL_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const START_PATH = /^\/[A-Za-z0-9._~/-]{0,200}$/;
const MAX_TEXT = 200;
const MAX_MODELS = 32;
const MAX_STOP_MARKERS = 16;

// [default, minimum, maximum]
export const LIMIT_BOUNDS = Object.freeze({
  timeoutMs: [600_000, 10_000, 1_800_000],
  navigationTimeoutMs: [30_000, 1_000, 120_000],
  actionTimeoutMs: [10_000, 500, 60_000],
  downloadTimeoutMs: [120_000, 1_000, 600_000],
  pollIntervalMs: [1_000, 50, 10_000],
  maxPromptChars: [2_000, 1, 10_000],
  maxImageBytes: [50 * 1024 * 1024, 1_024, 100 * 1024 * 1024],
  maxVideoBytes: [200 * 1024 * 1024, 1_024, 500 * 1024 * 1024],
  maxResultItems: [200, 1, 1_000],
});

// Body fields the flow reads. Everything else is unsupported or an override
// attempt, and is refused before launch.
const BODY_FIELDS = new Set(["model", "prompt", "n", "response_format"]);

// Credential material this provider never accepts, on the connection or in
// providerSpecificData. The browser profile is the only session.
const SECRET_CREDENTIAL_FIELDS = ["apiKey", "accessToken", "refreshToken", "idToken", "cookie", "cookies", "bearer", "authorization", "token"];
const SECRET_KEY = /cookie|token|bearer|authori[sz]ation|api[-_]?key|secret|password|session/i;

export const reject = (status, message, outcome = "invalid") => Object.assign(new Error(message), { status, outcome });
const bad = (message) => reject(400, `Adobe Firefly web UI ${message}`);

const present = (value) => value !== undefined && value !== null && !(isString(value) && value === "");
const onlyKeys = (record, allowed, where) => {
  for (const key of Object.keys(record)) if (!allowed.includes(key)) throw bad(`${where} has an unsupported field "${key.slice(0, 40)}"`);
};
const text = (value, where, max = MAX_TEXT) => {
  if (!isString(value) || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw bad(`${where} must be non-empty text of at most ${max} characters`);
  }
  return value;
};

/** Refuse any API key, bearer, token or cookie on the connection. */
export function assertNoSuppliedSecrets(credentials) {
  if (!isRecord(credentials)) return;
  for (const field of SECRET_CREDENTIAL_FIELDS) {
    if (present(credentials[field])) throw reject(400, "Adobe Firefly web UI accepts no API key, token, bearer or cookie; it uses only its operator-owned browser profile");
  }
  const specific = credentials.providerSpecificData;
  if (isRecord(specific)) {
    for (const [key, value] of Object.entries(specific)) {
      if (key !== FIREFLY_WEB_UI_KEY && SECRET_KEY.test(key) && present(value)) {
        throw reject(400, "Adobe Firefly web UI accepts no API key, token, bearer or cookie; it uses only its operator-owned browser profile");
      }
    }
  }
}

/**
 * A locator spec: `{ role, name?, exact? }` or `{ label, exact? }`. Returned
 * frozen and normalized; anything else is refused.
 */
export function parseLocator(value, where, { nameRequired = false } = {}) {
  if (!isRecord(value)) throw bad(`${where} must be a role/name or label locator`);
  if ("label" in value) {
    onlyKeys(value, ["label", "exact"], where);
    if (value.exact !== undefined && !isBoolean(value.exact)) throw bad(`${where}.exact must be a boolean`);
    return Object.freeze({ label: text(value.label, `${where}.label`), exact: value.exact !== false });
  }
  onlyKeys(value, ["role", "name", "exact"], where);
  if (!LOCATOR_ROLES.includes(value.role)) throw bad(`${where}.role must be one of: ${LOCATOR_ROLES.join(", ")}`);
  if (value.exact !== undefined && !isBoolean(value.exact)) throw bad(`${where}.exact must be a boolean`);
  const locator = { role: value.role, exact: value.exact !== false };
  if (nameRequired || value.name !== undefined) locator.name = text(value.name, `${where}.name`);
  return Object.freeze(locator);
}

function parseLimits(value) {
  if (value === undefined) value = {};
  if (!isRecord(value)) throw bad("limits must be an object");
  onlyKeys(value, Object.keys(LIMIT_BOUNDS), "limits");
  const limits = {};
  for (const [key, [fallback, min, max]] of Object.entries(LIMIT_BOUNDS)) {
    const given = value[key];
    if (given === undefined) { limits[key] = fallback; continue; }
    if (!isNumber(given) || !Number.isInteger(given) || given < min || given > max) throw bad(`limits.${key} must be an integer from ${min} to ${max}`);
    limits[key] = given;
  }
  if (limits.navigationTimeoutMs > limits.timeoutMs || limits.downloadTimeoutMs > limits.timeoutMs) {
    throw bad("limits.navigationTimeoutMs and limits.downloadTimeoutMs must not exceed limits.timeoutMs");
  }
  return Object.freeze(limits);
}

function parseModelMap(value) {
  if (!isRecord(value) || Object.keys(value).length === 0) throw bad("modelMap must map at least one public model id");
  if (Object.keys(value).length > MAX_MODELS) throw bad(`modelMap is limited to ${MAX_MODELS} models`);
  const models = {};
  for (const [id, entry] of Object.entries(value)) {
    if (!PUBLIC_MODEL_ID.test(id)) throw bad(`modelMap id "${id.slice(0, 40)}" must be a lowercase public model id`);
    if (!isRecord(entry)) throw bad(`modelMap.${id} must be { label, kind }`);
    onlyKeys(entry, ["label", "kind"], `modelMap.${id}`);
    if (!KINDS.includes(entry.kind)) throw bad(`modelMap.${id}.kind must be image or video`);
    models[id] = Object.freeze({ label: text(entry.label, `modelMap.${id}.label`), kind: entry.kind });
  }
  return Object.freeze(models);
}

function parseValidation(mapping) {
  if (mapping.validatedBy !== "operator") throw bad("mapping must be validated by the operator (validatedBy \"operator\")");
  const at = isString(mapping.validatedAt) ? Date.parse(mapping.validatedAt) : NaN;
  if (!/^\d{4}-\d{2}-\d{2}T/.test(mapping.validatedAt ?? "") || !Number.isFinite(at)) throw bad("mapping.validatedAt must be an ISO 8601 timestamp");
  return new Date(at).toISOString();
}

function parseStartPaths(value) {
  if (value === undefined) return Object.freeze({ image: "/", video: "/" });
  if (!isRecord(value)) throw bad("mapping.startPaths must be an object");
  onlyKeys(value, KINDS, "mapping.startPaths");
  const paths = {};
  for (const kind of KINDS) {
    const given = value[kind] ?? "/";
    if (!isString(given) || !START_PATH.test(given) || given.includes("//") || given.split("/").includes("..")) {
      throw bad(`mapping.startPaths.${kind} must be a plain path on the Firefly origin`);
    }
    paths[kind] = given;
  }
  return Object.freeze(paths);
}

/**
 * The operator mapping. Actor locators (prompt, submit, model picker and the
 * requested model's option) must
 * each match exactly one actionable element before submit; observer locators
 * (resultItem, resultReady, download, stop markers) are only shape-checked
 * here and may be absent until the result exists.
 */
export function parseMapping(value) {
  if (!isRecord(value)) throw bad("mapping is required before generation");
  onlyKeys(value, ["validatedBy", "validatedAt", "startPaths", "locators"], "mapping");
  const validatedAt = parseValidation(value);
  const locators = value.locators;
  if (!isRecord(locators)) throw bad("mapping.locators is required");
  onlyKeys(locators, ["prompt", "submit", "modelPicker", "modelOptionRole", "resultItem", "identityAttr", "resultReady", "download", "stopMarkers"], "mapping.locators");
  const parsed = {
    prompt: parseLocator(locators.prompt, "mapping.locators.prompt"),
    submit: parseLocator(locators.submit, "mapping.locators.submit"),
    modelPicker: parseLocator(locators.modelPicker, "mapping.locators.modelPicker"),
    modelOptionRole: null,
    resultItem: parseLocator(locators.resultItem, "mapping.locators.resultItem"),
    identityAttr: null,
    resultReady: parseLocator(locators.resultReady, "mapping.locators.resultReady"),
    download: parseLocator(locators.download, "mapping.locators.download"),
    stopMarkers: [],
  };
  // The requested model is always selected explicitly, never assumed from the UI's current default.
  if (!OPTION_ROLES.has(locators.modelOptionRole)) throw bad(`mapping.locators.modelOptionRole must be one of: ${[...OPTION_ROLES].join(", ")}`);
  parsed.modelOptionRole = locators.modelOptionRole;
  if (locators.identityAttr !== undefined) {
    if (!isString(locators.identityAttr) || !IDENTITY_ATTR.test(locators.identityAttr) || locators.identityAttr.length > 64) {
      throw bad("mapping.locators.identityAttr must be id or a data-* attribute name");
    }
    parsed.identityAttr = locators.identityAttr;
  }
  if (!Array.isArray(locators.stopMarkers) || locators.stopMarkers.length === 0 || locators.stopMarkers.length > MAX_STOP_MARKERS) {
    throw bad(`mapping.locators.stopMarkers must list 1 to ${MAX_STOP_MARKERS} sign-in, challenge, consent or entitlement markers`);
  }
  parsed.stopMarkers = Object.freeze(locators.stopMarkers.map((marker, index) => parseLocator(marker, `mapping.locators.stopMarkers[${index}]`)));
  return Object.freeze({ validatedBy: "operator", validatedAt, startPaths: parseStartPaths(value.startPaths), locators: Object.freeze(parsed) });
}

/**
 * The stored config. `purpose` "setup" needs only the guard and the profile
 * handle; "generation" also needs the operator mapping and the model map.
 */
export function parseFireflyWebUiConfig(credentials, { purpose = "generation" } = {}) {
  assertNoSuppliedSecrets(credentials);
  const raw = credentials?.providerSpecificData?.[FIREFLY_WEB_UI_KEY];
  if (!isRecord(raw)) throw reject(403, "Adobe Firefly web UI is not configured on this connection", "disabled");
  if (raw.enabled !== true) throw reject(403, "Adobe Firefly web UI is disabled on this connection", "disabled");
  onlyKeys(raw, ["enabled", "profileHandle", "mapping", "modelMap", "limits"], "config");
  if (!isString(raw.profileHandle) || !PROFILE_HANDLE_PATTERN.test(raw.profileHandle)) {
    throw reject(409, "Adobe Firefly web UI has no initialized browser profile on this connection", "needs_operator");
  }
  const base = { enabled: true, profileHandle: raw.profileHandle, limits: parseLimits(raw.limits) };
  if (purpose === "setup") return Object.freeze(base);
  return Object.freeze({ ...base, mapping: parseMapping(raw.mapping), modelMap: parseModelMap(raw.modelMap) });
}

/**
 * The validated generation request for `kind`, or a 400 before launch: only a
 * configured model of this kind, one text prompt, n 1, and the declared
 * b64_json output. Omitted response_format means b64_json; any other format
 * is refused, never silently changed.
 */
export function prepareFireflyWebUiRequest(config, { kind, model, body }) {
  if (!KINDS.includes(kind)) throw bad("kind must be image or video");
  if (!isRecord(body)) throw bad("request must be a JSON object");
  for (const key of Object.keys(body)) {
    if (!BODY_FIELDS.has(key) && body[key] !== undefined) {
      throw bad(`does not support "${key.slice(0, 40)}": only model, prompt, n 1 and response_format b64_json are accepted`);
    }
  }
  const mapped = Object.hasOwn(config.modelMap, model) ? config.modelMap[model] : null;
  if (!mapped) throw bad("model is not in this connection's operator-validated modelMap");
  if (mapped.kind !== kind) throw bad(`model is a ${mapped.kind} model, not a ${kind} model`);
  if (body.n !== undefined && body.n !== null && body.n !== 1) throw bad("generates exactly one result per request (n 1)");
  const format = body.response_format ?? RESPONSE_FORMAT;
  if (format !== RESPONSE_FORMAT) throw bad(`returns local b64_json output only; response_format "${String(format).slice(0, 20)}" is not supported`);
  if (!isString(body.prompt) || !body.prompt.trim()) throw bad("needs a text prompt");
  if (body.prompt.length > config.limits.maxPromptChars) throw bad(`prompts are limited to ${config.limits.maxPromptChars} characters`);
  return Object.freeze({ kind, model, label: mapped.label, prompt: body.prompt, responseFormat: RESPONSE_FORMAT });
}
