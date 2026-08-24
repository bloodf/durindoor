// Gemini helper functions for translator

import { safeParseJSON } from "../concerns/json.js";
import { OPENAI_BLOCK } from "../schema/index.js";

// Unsupported JSON Schema constraints that should be removed for Antigravity
import { isObject, isString } from "@/shared/utils/typeChecks.js";export const UNSUPPORTED_SCHEMA_CONSTRAINTS = [
// Basic constraints (not supported by Gemini API)
"minLength", "maxLength", "exclusiveMinimum", "exclusiveMaximum",
"minItems", "maxItems", "multipleOf", "format",
// Claude rejects these in VALIDATED mode
"default", "examples",
// JSON Schema meta keywords ($ref/$defs are resolved by resolveJsonSchemaRefs in Phase 0;
// these remain as fallback cleanup for any unresolved remnants)
"$schema", "$defs", "definitions", "const", "$ref", "$comment",
// Annotation keywords (rejected by Gemini/Antigravity - e.g. MCP tool schemas set these)
"deprecated", "readOnly", "writeOnly",
"encrypted",
// Object validation keywords (not supported)
"additionalProperties", "propertyNames", "patternProperties", "enumDescriptions",
// Complex schema keywords (handled by flattenAnyOfOneOf/mergeAllOf)
"anyOf", "oneOf", "allOf", "not",
// Dependency keywords (not supported)
"dependencies", "dependentSchemas", "dependentRequired",
// Other unsupported keywords
"title", "optional", "deprecated", "if", "then", "else", "contentMediaType", "contentEncoding",
// UI/Styling properties (from Cursor tools - NOT JSON Schema standard)
"cornerRadius", "fillColor", "fontFamily", "fontSize", "fontWeight",
"gap", "padding", "strokeColor", "strokeThickness", "textColor"];


/**
 * Non-schema keys to remove only from schema nodes, never from user-defined
 * property name-maps where the same strings are valid property names.
 */
const STRAY_SCHEMA_KEYS = new Set(["value"]);

// Resolve $ref pointers in-place before removing unsupported keywords.
// Supports #/$defs/<name> and #/definitions/<name> (JSON Schema draft-07 / 2020-12).
// Circular/deeply-nested refs are guarded by a max depth to prevent infinite recursion.
const MAX_REF_DEPTH = 10;

function resolveJsonSchemaRefs(schema) {
  if (!schema || !isObject(schema)) return;

  // Collect definitions from $defs or definitions
  const defs = schema.$defs || schema.definitions || {};

  function lookupRef(ref) {
    if (!isString(ref)) return null;
    // Support #/$defs/Name and #/definitions/Name
    const match = ref.match(/^#\/(\$defs|definitions)\/(.+)$/);
    if (!match) return null;
    const name = match[2];
    return defs[name] || null;
  }

  function resolve(obj, depth) {
    if (!obj || !isObject(obj) || depth > MAX_REF_DEPTH) return;

    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        if (obj[i] && isObject(obj[i]) && obj[i].$ref) {
          const resolved = lookupRef(obj[i].$ref);
          if (resolved) {
            obj[i] = structuredClone(resolved);
            resolve(obj[i], depth + 1);
          }
        } else {
          resolve(obj[i], depth + 1);
        }
      }
      return;
    }

    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (val && isObject(val)) {
        if (val.$ref) {
          const resolved = lookupRef(val.$ref);
          if (resolved) {
            obj[key] = structuredClone(resolved);
            resolve(obj[key], depth + 1);
          } else {
            // Unresolvable $ref — remove it and mark as string fallback
            delete val.$ref;
            if (Object.keys(val).length === 0) {
              obj[key] = { type: "string", description: "(unresolved reference)" };
            }
          }
        } else {
          resolve(val, depth + 1);
        }
      }
    }
  }

  resolve(schema, 0);

  // Remove the definitions containers after resolving
  delete schema.$defs;
  delete schema.definitions;
}

// Default safety settings
export const DEFAULT_SAFETY_SETTINGS = [
{ category: "HARM_CATEGORY_HATE_SPEECH", threshold: "OFF" },
{ category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "OFF" },
{ category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "OFF" },
{ category: "HARM_CATEGORY_HARASSMENT", threshold: "OFF" }];


/**
 * Convert OpenAI-style content into Gemini/Antigravity parts.
 *
 * For `type: "file"` blocks, the following data aliases are accepted in order:
 *   - top-level: `item.data`, `item.file_data`, `item.fileData`
 *   - inside `item.file`: `file.data`, `file.file_data`, `file.fileData`
 *   - inside `item.document`: `document.data`, `document.file_data`, `document.fileData`
 *
 * MIME type resolution precedence:
 *   1. explicit `mime_type` / `mimeType` / `media_type` on the block, `file`, or `document` object
 *   2. MIME extracted from a `data:` URI prefix
 *   3. fallback `application/pdf`
 *
 * HTTP(S) URIs are intentionally skipped (Gemini inlineData requires inline bytes).
 */
export function convertOpenAIContentToParts(content) {
  const parts = [];

  if (isString(content)) {
    parts.push({ text: content });
  } else if (Array.isArray(content)) {
    for (const item of content) {
      if (item.type === OPENAI_BLOCK.TEXT) {
        parts.push({ text: item.text });
      } else if (item.type === OPENAI_BLOCK.IMAGE_URL && item.image_url?.url?.startsWith("data:")) {
        const url = item.image_url.url;
        const commaIndex = url.indexOf(",");
        if (commaIndex !== -1) {
          const mimePart = url.substring(5, commaIndex); // skip "data:"
          const data = url.substring(commaIndex + 1);
          const mimeType = mimePart.split(";")[0];

          parts.push({
            inlineData: { mimeType: mimeType, data: data }
          });
        }
      } else if (item.type === OPENAI_BLOCK.IMAGE_URL && item.image_url?.url && (item.image_url.url.startsWith("http://") || item.image_url.url.startsWith("https://"))) {
        parts.push({
          fileData: { fileUri: item.image_url.url, mimeType: "image/*" }
        });
      } else if (item.type === OPENAI_BLOCK.INPUT_AUDIO && item.input_audio?.data) {
        const format = item.input_audio.format || "wav";
        const mimeType = format === "mp3" ? "audio/mpeg" : `audio/${format}`;
        parts.push({
          inlineData: { mimeType: mimeType, data: item.input_audio.data }
        });
      } else if (item.type === OPENAI_BLOCK.AUDIO_URL && item.audio_url?.url?.startsWith("data:")) {
        const url = item.audio_url.url;
        const commaIndex = url.indexOf(",");
        if (commaIndex !== -1) {
          const mimePart = url.substring(5, commaIndex);
          const data = url.substring(commaIndex + 1);
          const mimeType = mimePart.split(";")[0];
          parts.push({
            inlineData: { mimeType: mimeType, data: data }
          });
        }
      } else if (item.type === OPENAI_BLOCK.FILE) {
        const rawDataStr =
        item.data ||
        item.file_data ||
        item.fileData ||
        item.file?.data ||
        item.file?.file_data ||
        item.file?.fileData ||
        item.document?.data ||
        item.document?.file_data ||
        item.document?.fileData;

        const explicitMimeType =
        item.mime_type ||
        item.mimeType ||
        item.media_type ||
        item.file?.mime_type ||
        item.file?.mimeType ||
        item.file?.media_type ||
        item.document?.mime_type ||
        item.document?.mimeType ||
        item.document?.media_type;

        if (isString(rawDataStr) && !rawDataStr.startsWith("http")) {
          let mimeType = explicitMimeType;
          let data = rawDataStr;

          if (rawDataStr.startsWith("data:")) {
            const commaIndex = rawDataStr.indexOf(",");
            if (commaIndex !== -1) {
              mimeType = mimeType || rawDataStr.substring(5, commaIndex).split(";")[0];
              data = rawDataStr.substring(commaIndex + 1);
            }
          }

          parts.push({
            inlineData: {
              mimeType: String(mimeType || "application/pdf"),
              data
            }
          });
        }
      }
    }
  }

  return parts;
}

// Extract text content from OpenAI content
export function extractTextContent(content, separator = "") {
  if (isString(content)) return content;
  if (Array.isArray(content)) {
    return content.filter((c) => c.type === OPENAI_BLOCK.TEXT).map((c) => c.text).join(separator);
  }
  return "";
}

/**
 * Gemini documents a maximum function schema nesting depth of 32. Stop there
 * so attacker-adjacent tool results cannot exhaust the translator stack; any
 * deeper JSON remains byte-equivalent but is not rewritten.
 */
const MAX_FUNCTION_RESPONSE_SANITIZE_DEPTH = 32;

/**
 * Recursively rewrites keys Gemini interprets as schema references in parsed
 * function-response JSON while preserving array shape and scalar values.
 * Existing legal sibling keys win collisions; rewritten keys receive stable
 * `_2`, `_3`, ... suffixes in source-key order. Upstream PR #3411. Keep this
 * separate from general JSON parsing so tool-call arguments retain their keys.
 *
 * @param {unknown} value Parsed JSON value; live Date/class instances are unsupported.
 * @param {number} [depth=0] Current traversal depth.
 * @returns {unknown} Sanitized JSON value.
 */
export function sanitizeFunctionResponseResult(value, depth = 0) {
  if (!value || !isObject(value) || depth >= MAX_FUNCTION_RESPONSE_SANITIZE_DEPTH) return value;
  if (Array.isArray(value)) return value.map((nestedValue) => sanitizeFunctionResponseResult(nestedValue, depth + 1));

  const entries = Object.entries(value);
  const sanitized = Object.create(null);
  const rewrite = ([key]) => key === "definitions" || /[$#/]/.test(key);

  for (const [key, nestedValue] of entries.filter((entry) => !rewrite(entry))) {
    sanitized[key] = sanitizeFunctionResponseResult(nestedValue, depth + 1);
  }
  for (const [key, nestedValue] of entries.filter(rewrite).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    const baseKey = key === "definitions" ? "_definitions" : key.replace(/[$#/]/g, "_");
    let sanitizedKey = baseKey;
    for (let suffix = 2; Object.hasOwn(sanitized, sanitizedKey); suffix++) sanitizedKey = `${baseKey}_${suffix}`;
    sanitized[sanitizedKey] = sanitizeFunctionResponseResult(nestedValue, depth + 1);
  }
  return sanitized;
}

// Try parse JSON safely (null fallback on parse error; re-export keeps legacy API)
export function tryParseJSON(str) {
  return safeParseJSON(str, null);
}

// Generate request ID
export function generateRequestId() {
  return `agent-${crypto.randomUUID()}`;
}

// Generate session ID (binary-compatible format: UUID + timestamp)
export function generateSessionId() {
  return crypto.randomUUID() + Date.now().toString();
}

// Generate project ID
export function generateProjectId() {
  const adjectives = ["useful", "bright", "swift", "calm", "bold"];
  const nouns = ["fuze", "wave", "spark", "flow", "core"];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  return `${adj}-${noun}-${crypto.randomUUID().slice(0, 5)}`;
}

/**
 * Removes unsupported keywords from schema nodes while preserving every key
 * in a `properties` name-map and recursing into that map's values.
 */
function removeUnsupportedKeywords(obj, keywords, isPropertiesMap = false) {
  if (!obj || !isObject(obj)) return;

  if (Array.isArray(obj)) {
    for (const item of obj) removeUnsupportedKeywords(item, keywords);
    return;
  }

  const isSchemaNode = obj.type !== undefined || obj.properties !== undefined || obj.items !== undefined;
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (!isPropertiesMap && (keywords.includes(key) || key.startsWith("x-") || isSchemaNode && STRAY_SCHEMA_KEYS.has(key))) {
      delete obj[key];
      continue;
    }

    if (value && isObject(value)) {
      removeUnsupportedKeywords(value, keywords, !isPropertiesMap && key === "properties");
    }
  }
}

// Convert const to enum
function convertConstToEnum(obj) {
  if (!obj || !isObject(obj)) return;

  if (obj.const !== undefined && !obj.enum) {
    obj.enum = [obj.const];
    delete obj.const;
  }

  for (const value of Object.values(obj)) {
    if (value && isObject(value)) {
      convertConstToEnum(value);
    }
  }
}

// Convert enum values to strings (Gemini requires string enum values + explicit type:"string")
function convertEnumValuesToStrings(obj) {
  if (!obj || !isObject(obj)) return;

  if (obj.enum && Array.isArray(obj.enum)) {
    obj.enum = obj.enum.map((v) => String(v));
    // Gemini API requires type:"string" when enum is present — without it returns 400
    if (!obj.type) {
      obj.type = "string";
    }
  }

  for (const value of Object.values(obj)) {
    if (value && isObject(value)) {
      convertEnumValuesToStrings(value);
    }
  }
}

// Merge allOf schemas
function mergeAllOf(obj) {
  if (!obj || !isObject(obj)) return;

  if (obj.allOf && Array.isArray(obj.allOf)) {
    const merged = {};

    for (const item of obj.allOf) {
      if (item.properties) {
        if (!merged.properties) merged.properties = {};
        Object.assign(merged.properties, item.properties);
      }
      if (item.required && Array.isArray(item.required)) {
        if (!merged.required) merged.required = [];
        for (const req of item.required) {
          if (!merged.required.includes(req)) {
            merged.required.push(req);
          }
        }
      }
    }

    delete obj.allOf;
    if (merged.properties) obj.properties = { ...obj.properties, ...merged.properties };
    if (merged.required) obj.required = [...(obj.required || []), ...merged.required];
  }

  for (const value of Object.values(obj)) {
    if (value && isObject(value)) {
      mergeAllOf(value);
    }
  }
}

// Select best schema from anyOf/oneOf
function selectBest(items) {
  let bestIdx = 0;
  let bestScore = -1;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    let score = 0;
    const type = item.type;

    if (type === "object" || item.properties) {
      score = 3;
    } else if (type === "array" || item.items) {
      score = 2;
    } else if (type && type !== "null") {
      score = 1;
    }

    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  return bestIdx;
}

// Flatten anyOf/oneOf
function flattenAnyOfOneOf(obj) {
  if (!obj || !isObject(obj)) return;

  if (obj.anyOf && Array.isArray(obj.anyOf) && obj.anyOf.length > 0) {
    const nonNullSchemas = obj.anyOf.filter((s) => s && s.type !== "null");
    if (nonNullSchemas.length > 0) {
      const bestIdx = selectBest(nonNullSchemas);
      const selected = nonNullSchemas[bestIdx];
      delete obj.anyOf;
      Object.assign(obj, selected);
    }
  }

  if (obj.oneOf && Array.isArray(obj.oneOf) && obj.oneOf.length > 0) {
    const nonNullSchemas = obj.oneOf.filter((s) => s && s.type !== "null");
    if (nonNullSchemas.length > 0) {
      const bestIdx = selectBest(nonNullSchemas);
      const selected = nonNullSchemas[bestIdx];
      delete obj.oneOf;
      Object.assign(obj, selected);
    }
  }

  for (const value of Object.values(obj)) {
    if (value && isObject(value)) {
      flattenAnyOfOneOf(value);
    }
  }
}

// Flatten type arrays
function flattenTypeArrays(obj) {
  if (!obj || !isObject(obj)) return;

  if (obj.type && Array.isArray(obj.type)) {
    const nonNullTypes = obj.type.filter((t) => t !== "null");
    obj.type = nonNullTypes.length > 0 ? nonNullTypes[0] : "string";
  }

  for (const value of Object.values(obj)) {
    if (value && isObject(value)) {
      flattenTypeArrays(value);
    }
  }
}

/**
 * Infer missing `type: "object"` on schema nodes that carry `properties` but no
 * explicit `type` (Gemini requires the explicit type).
 *
 * Recurses ONLY into real schema nodes — the values of the `properties` map and
 * the `items` schema. Walking every value via `Object.values(obj)` is wrong: when a
 * schema property is itself named "properties", the properties-map dictionary would
 * be mistaken for a schema node and gain `type: "object"`, turning one of the
 * property values into the literal string `"object"` and triggering a Gemini 400.
 * Mutates `obj` in place.
 *
 * @param {object} obj - JSON Schema node to normalize (mutated in place).
 * @returns {void}
 */
function ensureObjectType(obj) {
  if (!obj || !isObject(obj)) return;
  if (obj.properties && !obj.type) obj.type = "object";
  // Recurse only into valid schema nodes: the values of the `properties` map and
  // the `items` schema. Walking every value via Object.values(obj) is wrong: when a
  // schema property is itself named "properties", the properties-map dictionary would
  // be mistaken for a schema node and gain `type: "object"`, turning one of the
  // property values into the literal string "object" -> Gemini 400.
  if (obj.properties && isObject(obj.properties)) {
    for (const v of Object.values(obj.properties)) if (v && isObject(v)) ensureObjectType(v);
  }
  if (obj.items && isObject(obj.items)) ensureObjectType(obj.items);
}

// Clean JSON Schema for Antigravity API compatibility - removes unsupported keywords recursively
export function cleanJSONSchemaForAntigravity(schema) {
  if (!schema || !isObject(schema)) return schema;

  // Mutate directly (schema is only used once per request)
  let cleaned = schema;

  // Phase 0: Resolve $ref pointers BEFORE removing unsupported keywords.
  // This inlines referenced definitions so that the schema is self-contained.
  // Without this, $ref removal leaves empty objects that get placeholder-filled,
  // producing invalid schemas that Google Antigravity rejects (bug #2877/#2884).
  resolveJsonSchemaRefs(cleaned);

  // Phase 1: Convert and prepare
  convertConstToEnum(cleaned);
  convertEnumValuesToStrings(cleaned);

  // Phase 2: Flatten complex structures
  mergeAllOf(cleaned);
  flattenAnyOfOneOf(cleaned);
  flattenTypeArrays(cleaned);

  // Phase 2.5: Infer missing type=object when properties exist (Gemini requirement)
  ensureObjectType(cleaned);

  // Phase 3: Remove all unsupported keywords at ALL levels (including inside arrays)
  removeUnsupportedKeywords(cleaned, UNSUPPORTED_SCHEMA_CONSTRAINTS);

  // Phase 4: Cleanup required fields recursively.
  // Descend only into real schema nodes — the values of the `properties` map
  // and the `items` schema. The name-map keys under `properties` are
  // user-chosen parameter names, not schema keywords (#2884).
  function cleanupRequired(obj) {
    if (!obj || !isObject(obj)) return;

    if (obj.required && Array.isArray(obj.required) && obj.properties) {
      const validRequired = obj.required.filter((field) =>
      Object.prototype.hasOwnProperty.call(obj.properties, field)
      );
      if (validRequired.length === 0) {
        delete obj.required;
      } else {
        obj.required = validRequired;
      }
    }

    if (obj.properties && isObject(obj.properties)) {
      for (const v of Object.values(obj.properties)) {
        if (v && isObject(v)) cleanupRequired(v);
      }
    }
    if (obj.items && isObject(obj.items)) cleanupRequired(obj.items);
  }

  cleanupRequired(cleaned);

  // Phase 5: Add placeholder for empty object schemas (Antigravity requirement).
  // Descend only into real schema nodes — the values of the `properties` map
  // and the `items` schema. The name-map keys under `properties` are
  // user-chosen parameter names, not schema keywords (#2884).
  function addPlaceholders(obj) {
    if (!obj || !isObject(obj)) return;

    // Empty schema {} (no type, no properties) after $ref removal — treat as object with placeholder
    if (Object.keys(obj).length === 0) {
      obj.type = "object";
      obj.properties = {
        reason: {
          type: "string",
          description: "Brief explanation of why you are calling this tool"
        }
      };
      obj.required = ["reason"];
      return;
    }

    if (obj.type === "object") {
      if (!obj.properties || Object.keys(obj.properties).length === 0) {
        obj.properties = {
          reason: {
            type: "string",
            description: "Brief explanation of why you are calling this tool"
          }
        };
        obj.required = ["reason"];
      }
    }

    if (obj.properties && isObject(obj.properties)) {
      for (const v of Object.values(obj.properties)) {
        if (v && isObject(v)) addPlaceholders(v);
      }
    }
    if (obj.items && isObject(obj.items)) addPlaceholders(obj.items);
  }

  addPlaceholders(cleaned);

  return cleaned;
}