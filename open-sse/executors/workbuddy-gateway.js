import { isString, isObject, isNumber, isBoolean, isFunction, runtimeTypeName } from "../../src/shared/utils/typeChecks.js";
// Ported from OmniRoute release/v3.8.55, open-sse/utils/workbuddyGateway.ts.
import { createHash, randomBytes } from "node:crypto";
const WORKBUDDY_UA_VERSION = "5.5.6";
const WORKBUDDY_USER_AGENT = `WorkBuddy/${WORKBUDDY_UA_VERSION}`;
import { clientHeaders } from "../providers/registry/workbuddy.js";
const getWorkbuddyChatHeaders = () => ({ ...clientHeaders, "X-Agent-Intent": "craft", "X-Agent-Purpose": "conversation", "X-Agent-Type": "main" });
const WORKBUDDY_DEFAULT_HEADERS = getWorkbuddyChatHeaders();
const SALT = randomBytes(16).toString("hex");
function idFor(kind, key) {
  return createHash("sha256").update(`${SALT}|${kind}|${key}`).digest("hex").slice(0, 32);
}
function hex32() {
  return randomBytes(16).toString("hex");
}
function signatureOf(content) {
  if (isString(content)) return content;
  if (!Array.isArray(content)) return "";
  let out = "";
  for (const part of content) {
    if (!part || !isObject(part)) continue;
    const p = part;
    const type = isString(p.type) ? p.type : "";
    if (type === "" || type === "text") {
      out += isString(p.text) ? p.text : "";
    } else if (type !== "tool_result" && type !== "tool-result") {
      out += `[${type}:${createHash("sha256").update(JSON.stringify(part)).digest("hex").slice(0, 8)}]`;
    }
  }
  return out;
}
function answeredBefore(msgs, i) {
  const prev = msgs[i - 1];
  if (!prev || !isObject(prev)) return false;
  if (prev.role === "tool") return true;
  return prev.role === "assistant" && Array.isArray(prev.tool_calls) && prev.tool_calls.length > 0;
}
function turnKey(chat) {
  const msgs = Array.isArray(chat?.messages) ? chat.messages : [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i]?.role !== "user" || answeredBefore(msgs, i)) continue;
    const sig = signatureOf(msgs[i].content);
    return sig ? `u${i}:${sig}` : "";
  }
  return "";
}
function conversationKey(chat, session) {
  if (session) return `session:${session}`;
  const msgs = Array.isArray(chat?.messages) ? chat.messages : [];
  for (const m of msgs) {
    if (m?.role !== "user") continue;
    const sig = signatureOf(m?.content);
    if (sig) return `first:${sig}`;
  }
  return "";
}
function withWorkbuddyHeaders(headers, body = null, session) {
  const b = body && isObject(body) ? body : null;
  const sess = session || (isString(b?.session_id) ? b.session_id : void 0) || (isString(b?.prompt_cache_key) ? b.prompt_cache_key : void 0);
  const conv = conversationKey(b, sess);
  const msg = hex32();
  const write = (name, val) => {
    if (isFunction(headers?.set)) {
      headers.set(name, val);
    } else {
      headers[name] = val;
    }
  };
  const has = (name) => {
    if (isFunction(headers?.has)) {
      return headers.has(name);
    }
    return Boolean(headers[name]);
  };
  write("X-Conversation-Message-ID", msg);
  write("X-Request-ID", msg);
  if (!has("X-Conversation-Request-ID")) {
    const turn = turnKey(b);
    write("X-Conversation-Request-ID", turn ? idFor("turn", `${conv}|${turn}`) : hex32());
  }
  if (conv && !has("X-Conversation-ID")) {
    write("X-Conversation-ID", idFor("conversation", conv));
  }
  return headers;
}
const NAME_OK = /^[A-Za-z0-9_-]+$/;
const NUL_ESCAPE = /\\\\|\\0(?![0-9])/g;
const TYPES = /* @__PURE__ */ new Set(["string", "number", "integer", "boolean", "object", "array", "null"]);
const SUB_ONE = [
  "items",
  "additionalItems",
  "unevaluatedItems",
  "contains",
  "not",
  "if",
  "then",
  "else",
  "propertyNames",
  "additionalProperties",
  "unevaluatedProperties"
];
const SUB_LIST = ["anyOf", "oneOf", "allOf", "prefixItems"];
const SUB_MAP = ["properties", "patternProperties", "$defs", "definitions", "dependentSchemas"];
const BOOL_OK = /* @__PURE__ */ new Set(["additionalProperties", "unevaluatedProperties"]);
function safeToolName(name, taken) {
  const base = String(name).replace(/[^A-Za-z0-9_-]/g, "_") || "tool";
  let n = base;
  for (let i = 2; taken.has(n); i++) n = `${base}_${i}`;
  taken.add(n);
  return n;
}
function fitNulPattern(obj) {
  if (!isString(obj.pattern) || !obj.pattern.includes("\\0")) return false;
  const p = obj.pattern.replace(NUL_ESCAPE, (m) => m === "\\\\" ? m : "\\u0000");
  if (p === obj.pattern) return false;
  obj.pattern = p;
  return true;
}
function fitTupleItems(obj) {
  if (!Array.isArray(obj.items)) return false;
  const list = obj.items.filter((v) => v && isObject(v));
  obj.items = list.length === 0 ? {} : list.length === 1 ? list[0] : { anyOf: list };
  delete obj.additionalItems;
  return true;
}
function fitSchemaEach(values, depth) {
  let changed = false;
  for (const v of values) if (fitSchema(v, depth)) changed = true;
  return changed;
}
function fitSchema(s, depth = 0) {
  if (!s || !isObject(s) || depth > 64) return false;
  if (Array.isArray(s)) return fitSchemaEach(s, depth + 1);
  const obj = s;
  const pattern = fitNulPattern(obj);
  const items = fitTupleItems(obj);
  const nested = fitSchemaEach(Object.values(obj), depth + 1);
  return pattern || items || nested;
}
function valueType(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (isNumber(v)) return Number.isInteger(v) ? "integer" : "number";
  return runtimeTypeName(v);
}
function listedTypes(s) {
  if (Array.isArray(s.type)) return s.type;
  return isString(s.type) ? [s.type] : [];
}
function groupEnumByType(values) {
  const byType = /* @__PURE__ */ new Map();
  for (const v of values) {
    const t = valueType(v);
    const group = byType.get(t);
    if (group) group.push(v);
    else byType.set(t, [v]);
  }
  if (byType.has("integer") && byType.has("number")) {
    byType.get("number").push(...byType.get("integer"));
    byType.delete("integer");
  }
  return byType;
}
function setSingleEnumType(s, byType, hasNull) {
  const [t] = byType.keys();
  const want = t === void 0 ? "null" : hasNull ? [t, "null"] : t;
  if (JSON.stringify(want) === JSON.stringify(s.type)) return false;
  s.type = want;
  return true;
}
function splitEnumByType(s, byType, hasNull) {
  const split = [...byType].map(([t, vs]) => ({ type: t, enum: vs }));
  if (hasNull) split.push({ type: "null" });
  delete s.enum;
  delete s.type;
  if (Array.isArray(s.anyOf)) {
    s.allOf = [...Array.isArray(s.allOf) ? s.allOf : [], { anyOf: split }];
  } else {
    s.anyOf = split;
  }
  return true;
}
function fitEnum(s) {
  if (!("enum" in s)) return false;
  if (!Array.isArray(s.enum) || s.enum.length === 0) {
    delete s.enum;
    return true;
  }
  if (listedTypes(s).filter((t) => t !== "null").length === 1) return false;
  const byType = groupEnumByType(s.enum);
  const hasNull = byType.delete("null");
  return byType.size <= 1 ? setSingleEnumType(s, byType, hasNull) : splitEnumByType(s, byType, hasNull);
}
function subSchema(v, key) {
  if (!isBoolean(v) || BOOL_OK.has(key)) return v;
  return v ? {} : { not: {} };
}
function fitType(obj) {
  if (!("type" in obj)) return false;
  const list = (Array.isArray(obj.type) ? obj.type : [obj.type]).map((t) => isString(t) ? t.toLowerCase() : t).filter((t) => TYPES.has(t));
  const uniq = [...new Set(list)];
  const want = uniq.length === 0 ? void 0 : uniq.length === 1 ? uniq[0] : uniq;
  if (JSON.stringify(want) === JSON.stringify(obj.type)) return false;
  if (want === void 0) delete obj.type;
  else obj.type = want;
  return true;
}
function fitRequired(obj) {
  if ("required" in obj && !Array.isArray(obj.required)) {
    delete obj.required;
    return true;
  }
  if (Array.isArray(obj.required) && obj.required.some((k) => !isString(k))) {
    obj.required = obj.required.filter((k) => isString(k));
    return true;
  }
  return false;
}
function fitSlot(container, slot, key, depth) {
  const v0 = container[slot];
  const v = subSchema(v0, key);
  const replaced = v !== v0;
  if (replaced) container[slot] = v;
  const nested = fitSchemaTypes(v, depth + 1);
  return replaced || nested;
}
function fitSubOne(obj, depth) {
  let changed = false;
  for (const k of SUB_ONE) {
    if (k in obj && fitSlot(obj, k, k, depth)) changed = true;
  }
  return changed;
}
function fitSubList(obj, depth) {
  let changed = false;
  for (const k of SUB_LIST) {
    const list = obj[k];
    if (!Array.isArray(list)) continue;
    list.forEach((_, i) => {
      if (fitSlot(list, i, k, depth)) changed = true;
    });
  }
  return changed;
}
function fitSubMap(obj, depth) {
  let changed = false;
  for (const k of SUB_MAP) {
    const m = obj[k];
    if (!m || !isObject(m) || Array.isArray(m)) continue;
    for (const name of Object.keys(m)) {
      if (fitSlot(m, name, k, depth)) changed = true;
    }
  }
  return changed;
}
function fitSchemaTypes(s, depth = 0) {
  if (!s || !isObject(s) || Array.isArray(s) || depth > 64) return false;
  const obj = s;
  const results = [
    fitType(obj),
    fitRequired(obj),
    fitEnum(obj),
    fitSubOne(obj, depth),
    fitSubList(obj, depth),
    fitSubMap(obj, depth)
  ];
  return results.some(Boolean);
}
function collectValidToolNames(tools) {
  const taken = /* @__PURE__ */ new Set();
  for (const t of tools) {
    const n = t?.function?.name;
    if (isString(n) && NAME_OK.test(n)) taken.add(n);
  }
  return taken;
}
function toolFunction(t) {
  const fn = t?.type === "function" || t?.function ? t.function : null;
  return fn && isObject(fn) ? fn : null;
}
function fitToolParameters(fn) {
  if (fn.parameters === void 0) return false;
  if (!fn.parameters || !isObject(fn.parameters) || Array.isArray(fn.parameters)) {
    fn.parameters = { type: "object", properties: {} };
    return true;
  }
  const schema = fitSchema(fn.parameters);
  const fitted = fitSchemaTypes(fn.parameters);
  return schema || fitted;
}
function fitToolFunction(fn, taken, names, theirs) {
  let renamed = false;
  if (isString(fn.name) && !NAME_OK.test(fn.name)) {
    const safe = safeToolName(fn.name, taken);
    names.set(safe, fn.name);
    theirs.set(fn.name, safe);
    fn.name = safe;
    renamed = true;
  }
  const params = fitToolParameters(fn);
  return renamed || params;
}
function renameMessageToolRefs(m, theirs) {
  if (Array.isArray(m?.tool_calls)) {
    for (const c of m.tool_calls) {
      const fn = c?.function;
      const safe = theirs.get(fn?.name);
      if (safe && fn) fn.name = safe;
    }
  }
  if (m?.role === "tool" && isString(m.name) && theirs.has(m.name)) {
    m.name = theirs.get(m.name);
  }
}
function fitTools(body) {
  const names = /* @__PURE__ */ new Map();
  if (!Array.isArray(body?.tools) || !body.tools.length) return { changed: false, names };
  const tools = body.tools;
  const taken = collectValidToolNames(tools);
  const theirs = /* @__PURE__ */ new Map();
  let changed = false;
  for (const t of tools) {
    const fn = toolFunction(t);
    if (fn && fitToolFunction(fn, taken, names, theirs)) changed = true;
  }
  if (theirs.size && Array.isArray(body.messages)) {
    for (const m of body.messages)
      renameMessageToolRefs(m, theirs);
  }
  if (names.size) {
    const merged = body._toolNameMap instanceof Map ? new Map(body._toolNameMap) : /* @__PURE__ */ new Map();
    for (const [alias, original] of names) {
      merged.set(alias, original);
    }
    Object.defineProperty(body, "_toolNameMap", {
      value: merged,
      enumerable: false,
      configurable: true,
      writable: true
    });
  }
  return { changed, names };
}
function sanitizeToolChoice(body) {
  if (!("tool_choice" in body)) return false;
  const choice = body.tool_choice;
  if (isString(choice)) {
    if (choice.trim().toLowerCase() === "none") {
      delete body.tool_choice;
      delete body.tools;
      delete body.functions;
      return true;
    }
    return false;
  }
  if (!choice || !isObject(choice) || Array.isArray(choice)) {
    delete body.tool_choice;
    return true;
  }
  const c = choice;
  const type = isString(c.type) ? c.type.trim().toLowerCase() : "";
  if (type === "none") {
    delete body.tool_choice;
    delete body.tools;
    delete body.functions;
    return true;
  }
  if (type === "auto" || type === "required") {
    body.tool_choice = type;
    return true;
  }
  if (type === "function") {
    const fn = c.function;
    const name = isString(fn?.name) ? fn.name.trim() : "";
    body.tool_choice = name || "auto";
    return true;
  }
  delete body.tool_choice;
  return true;
}
function alignTurnOrder(messages) {
  let i = messages.length - 1;
  while (i >= 0 && messages[i]?.role === "user") i--;
  if (i < messages.length - 1 && i >= 0 && messages[i]?.role === "tool") {
    messages.splice(i + 1, 0, { role: "assistant", content: "" });
    return true;
  }
  return false;
}
const BILLING_HEADER_RE = /x-anthropic-billing-header:[^\n]*\n?/gi;
function sanitizeWorkbuddyBody(body) {
  if (!body || !isObject(body) || Array.isArray(body)) return body;
  const b = { ...body };
  if (b.max_completion_tokens !== void 0) {
    if (b.max_tokens === void 0) b.max_tokens = b.max_completion_tokens;
    delete b.max_completion_tokens;
  }
  if (Array.isArray(b.messages) && b.messages.length > 0) {
    const msgs = b.messages.map((m) => {
      if (!m || !isObject(m)) return m;
      const msg = { ...m };
      if (msg.role === "developer") msg.role = "system";
      if (isString(msg.content) && BILLING_HEADER_RE.test(msg.content)) {
        msg.content = msg.content.replace(BILLING_HEADER_RE, "").trim();
      }
      return msg;
    });
    if (msgs[0]?.role !== "system") {
      msgs.unshift({ role: "system", content: "You are a helpful assistant." });
    }
    alignTurnOrder(msgs);
    b.messages = msgs;
  }
  fitTools(b);
  sanitizeToolChoice(b);
  return b;
}
export {
  WORKBUDDY_DEFAULT_HEADERS,
  alignTurnOrder,
  conversationKey,
  fitSchema,
  fitSchemaTypes,
  fitTools,
  sanitizeToolChoice,
  sanitizeWorkbuddyBody,
  turnKey,
  withWorkbuddyHeaders
};
