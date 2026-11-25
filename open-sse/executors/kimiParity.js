// Kimi Coding request compatibility, adapted from CLIProxyAPI and OmniRoute (MIT).
import { isRecord as record, isString, isNumber } from "../../src/shared/utils/typeChecks.js";
const k31 = (model) => /(?:^|\/)(?:kimi-)?k3\.1(?:$|-)/i.test(model || "");
const aliases = { ultra: "max", xhigh: "max", medium: "high", minimum: "low", light: "low" };

export function normalizeKimiModel(model) {
  const value = String(model || "").trim().toLowerCase().replace(/\[1m\](?=\(|$)/, "");
  const match = value.match(/^(.*?)(\([^()]*\))?$/);
  let base = match[1];
  if (/^(?:kimi-)?(?:k2\.8(?:-code|-preview)?|k2\.7-code|for-coding)$/.test(base)) base = "kimi-for-coding";
  else if (/^(?:kimi-)?(?:k2\.7-code-highspeed|for-coding-highspeed)$/.test(base)) base = "kimi-for-coding-highspeed";
  else base = base.replace(/^kimi-/, "");
  return base + (match[2] || "");
}

const schemaLimits = { work: 50_000, bytes: 256 * 1024, depth: 64 };
const schemaBudgetExhausted = Symbol("Kimi schema budget exhausted");

function charge(budget, work, bytes = 0) {
  budget.work -= work;
  budget.bytes -= bytes;
  if (budget.work < 0 || budget.bytes < 0) throw schemaBudgetExhausted;
}

// Count JSON string bytes without allocating an escaped copy. Six bytes per
// UTF-16 code unit covers escapes; ordinary ASCII and UTF-8 use fewer.
function chargeString(budget, value) {
  charge(budget, value.length, value.length + 2);
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 32) charge(budget, 0, 5);
    else if (code === 34 || code === 92) charge(budget, 0, 1);
    else if (code >= 0xd800 && code <= 0xdfff) charge(budget, 0, 5);
    else if (code >= 0x800) charge(budget, 0, 2);
    else if (code >= 0x80) charge(budget, 0, 1);
  }
}

function inlineSchema(schema, budget, depth) {
  const activeRefs = new Set();
  let wroteRef = false;

  function visit(value, level, destination) {
    if (level > budget.depth) throw schemaBudgetExhausted;
    charge(budget, 1);
    if (Array.isArray(value)) {
      charge(budget, 0, 2);
      const result = [];
      for (const item of value) {
        charge(budget, 1, 1);
        result.push(visit(item, level + 1));
      }
      return result;
    }
    if (!record(value)) {
      if (isString(value)) chargeString(budget, value);
      else charge(budget, 0, String(value).length);
      return value;
    }

    charge(budget, 0, 2);
    const result = destination ?? {};
    const ref = value.$ref;
    let expanded = false;
    if (isString(ref) && ref.startsWith("#/")) {
      charge(budget, ref.length);
      if (!activeRefs.has(ref)) {
        let target = schema;
        for (const segment of ref.slice(2).split("/")) {
          const key = segment.replace(/~1/g, "/").replace(/~0/g, "~");
          if (target == null || !Object.hasOwn(target, key)) {
            target = undefined;
            break;
          }
          target = target[key];
        }
        if (record(target)) {
          expanded = true;
          activeRefs.add(ref);
          visit(target, level + 1, result);
        }
      }
    }
    for (const key in value) {
      if (!Object.hasOwn(value, key)) continue;
      charge(budget, 1, 2);
      if (key === "$ref") {
        if (expanded) continue;
        wroteRef = true;
      }
      chargeString(budget, key);
      Object.defineProperty(result, key, {
        value: visit(value[key], level + 1),
        enumerable: true, writable: true, configurable: true,
      });
    }
    if (expanded) activeRefs.delete(ref);
    return result;
  }

  function hasRef(value) {
    if (!record(value) && !Array.isArray(value)) return false;
    for (const key in value) {
      charge(budget, 1);
      if (Object.hasOwn(value, key) && (key === "$ref" || hasRef(value[key]))) return true;
    }
    return false;
  }

  const result = visit(schema, depth);
  if (!wroteRef || !hasRef(result)) {
    delete result.$defs;
    delete result.definitions;
  }
  if (result.type == null) {
    charge(budget, 1, '"type":"object",'.length);
    result.type = "object";
  }
  return result;
}

function normalizeTools(tools, budget, depth = 0) {
  if (!Array.isArray(tools)) return;
  if (depth > budget.depth) throw schemaBudgetExhausted;
  for (const tool of tools) {
    charge(budget, 1);
    if (!record(tool)) continue;
    const container = record(tool.function) ? tool.function : tool;
    if (record(container.parameters)) {
      container.parameters = inlineSchema(container.parameters, budget, depth);
    }
    normalizeTools(tool.tools, budget, depth + 1);
    normalizeTools(tool.children, budget, depth + 1);
  }
}

// All tool lists share one expansion budget. On exhaustion the current schema
// keeps its original definitions and references, and later schemas are left as-is.
function normalizeToolSchemas(body, limits) {
  const budget = { ...limits };
  try {
    normalizeTools(body.tools, budget);
    normalizeTools(body.functions, budget);
    if (Array.isArray(body.input)) {
      for (const item of body.input) {
        charge(budget, 1);
        if (["additional_tools", "tool_search_output"].includes(item?.type)) {
          normalizeTools(item.tools, budget);
        }
      }
    }
  } catch (error) {
    if (error !== schemaBudgetExhausted) throw error;
  }
}

function normalizeHistory(body) {
  if (!Array.isArray(body.messages)) return;
  const pending = [];
  let latest = "";
  for (const msg of body.messages) {
    if (msg?.role === "assistant") {
      if (isString(msg.reasoning_content) && msg.reasoning_content.trim() && msg.reasoning_content.trim() !== "[reasoning unavailable]") latest = msg.reasoning_content;
      if (Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
        if (!isString(msg.reasoning_content) || !msg.reasoning_content.trim() || msg.reasoning_content.trim() === "[reasoning unavailable]") {
          const content = isString(msg.content) ? msg.content.trim() : Array.isArray(msg.content) ? msg.content.map((part) => part?.text?.trim()).filter(Boolean).join("\n") : "";
          msg.reasoning_content = latest || content || "[reasoning unavailable]";
        }
        for (const call of msg.tool_calls) if (isString(call?.id) && call.id.trim()) pending.push(call.id.trim());
      }
    } else if (msg?.role === "tool") {
      const id = (isString(msg.tool_call_id) && msg.tool_call_id.trim()) || (isString(msg.call_id) && msg.call_id.trim()) || (pending.length === 1 ? pending[0] : "");
      if (id) { msg.tool_call_id = id; const index = pending.indexOf(id); if (index !== -1) pending.splice(index, 1); }
    }
  }
}

/** Apply Kimi Coding wire rules after format translation. */
export function normalizeKimiRequest(body, model, format, limits = schemaLimits) {
  if (!record(body)) return body;
  if (body.model) body.model = normalizeKimiModel(body.model);
  normalizeToolSchemas(body, limits);
  if ((k31(model) || (format === "claude" && record(body.thinking))) && (format === "openai" || format === "claude")) {
    const thinking = record(body.thinking) ? body.thinking : {};
    const config = record(body.output_config) ? body.output_config : {};
    let effort = body.reasoning_effort ?? body.reasoning?.effort ?? (format === "claude" ? config.effort : undefined) ?? thinking.effort;
    if (effort === undefined && (body.enable_thinking === false || thinking.type === "disabled")) effort = "off";
    if (effort === undefined && format === "claude" && isNumber(thinking.budget_tokens)) effort = thinking.budget_tokens <= 1024 ? "low" : thinking.budget_tokens <= 10240 ? "medium" : "high";
    effort ??= k31(model) ? "max" : thinking.type === "disabled" ? "off" : "on";
    if (isString(effort)) { effort = effort.trim().toLowerCase(); if (effort === "none") effort = "off"; effort = aliases[effort] || effort; }
    delete body.reasoning_effort; delete body.reasoning; delete body.enable_thinking;
    if (format === "openai") {
      body.thinking = effort === "off" ? { type: "disabled" } : { type: "enabled", effort, keep: thinking.keep ?? "all" };
      if (effort === "off" && thinking.keep !== undefined) body.thinking.keep = thinking.keep;
    }
    else {
      body.thinking = { type: effort === "off" ? "disabled" : "enabled" };
      const edits = Array.isArray(body.context_management?.edits) ? body.context_management.edits.filter((e) => e?.type !== "clear_thinking_20251015") : [];
      if (effort === "off") { delete body.output_config; if (edits.length) body.context_management.edits = edits; else { delete body.context_management; if (Array.isArray(body.betas)) { body.betas = body.betas.filter((b) => b !== "context-management-2025-06-27"); if (!body.betas.length) delete body.betas; } } }
      else {
        if (effort === "on" && !k31(model)) delete body.output_config;
        else body.output_config = { ...config, effort };
        body.context_management = { ...body.context_management, edits: [{ type: "clear_thinking_20251015", keep: "all" }, ...edits] };
        body.betas = [...(Array.isArray(body.betas) ? body.betas.filter((b) => b !== "context-management-2025-06-27") : []), "context-management-2025-06-27"];
        if (Array.isArray(body.messages)) for (const msg of body.messages) if (msg?.role === "assistant" && Array.isArray(msg.content) && msg.content.some((b) => b?.type === "tool_use") && !msg.content.some((b) => ["thinking", "redacted_thinking"].includes(b?.type))) msg.content.unshift({ type: "thinking", thinking: "" });
      }
    }
  }
  if (format === "openai") normalizeHistory(body);
  if (body.temperature !== undefined && body.temperature !== (body.thinking?.type === "disabled" ? 0.6 : 1)) delete body.temperature;
  return body;
}
