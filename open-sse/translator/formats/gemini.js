// Gemini helper functions for translator

import { safeParseJSON } from "../concerns/json.js";
import { OPENAI_BLOCK } from "../schema/index.js";

// Unsupported JSON Schema constraints that should be removed for Antigravity
export const UNSUPPORTED_SCHEMA_CONSTRAINTS = [
  // Basic constraints (not supported by Gemini API)
  "minLength", "maxLength", "exclusiveMinimum", "exclusiveMaximum",
  "minItems", "maxItems", "minContains", "maxContains", "multipleOf", "format",
  // Claude rejects these in VALIDATED mode
  "default", "examples",
  // JSON Schema meta keywords
  "$schema", "$defs", "definitions", "const", "$ref", "$comment",
  // Annotation keywords (rejected by Gemini/Antigravity - e.g. MCP tool schemas set these)
  "deprecated", "readOnly", "writeOnly",
  // Object validation keywords (not supported)
  "additionalProperties", "propertyNames", "patternProperties", "enumDescriptions",
  // Complex schema keywords (handled by flattenAnyOfOneOf/mergeAllOf)
  "anyOf", "oneOf", "allOf", "not",
  // Dependency keywords (not supported)
  "dependencies", "dependentSchemas", "dependentRequired",
  // Other unsupported keywords
  "title", "optional", "deprecated", "if", "then", "else", "contentMediaType", "contentEncoding",
  "uniqueItems", "prefixItems", "contains", "unevaluatedProperties", "unevaluatedItems", "contentSchema",
  // UI/Styling properties (from Cursor tools - NOT JSON Schema standard)
  "cornerRadius", "fillColor", "fontFamily", "fontSize", "fontWeight",
  "gap", "padding", "strokeColor", "strokeThickness", "textColor"
];

// Default safety settings
export const DEFAULT_SAFETY_SETTINGS = [
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "OFF" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "OFF" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "OFF" },
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "OFF" }
];

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

  if (typeof content === "string") {
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
            inlineData: { mime_type: mimeType, data: data }
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
          inlineData: { mime_type: mimeType, data: item.input_audio.data }
        });
      } else if (item.type === OPENAI_BLOCK.AUDIO_URL && item.audio_url?.url?.startsWith("data:")) {
        const url = item.audio_url.url;
        const commaIndex = url.indexOf(",");
        if (commaIndex !== -1) {
          const mimePart = url.substring(5, commaIndex);
          const data = url.substring(commaIndex + 1);
          const mimeType = mimePart.split(";")[0];
          parts.push({
            inlineData: { mime_type: mimeType, data: data }
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

        if (typeof rawDataStr === "string" && !rawDataStr.startsWith("http")) {
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
              mime_type: String(mimeType || "application/pdf"),
              data,
            },
          });
        }
      }
    }
  }

  return parts;
}

// Extract text content from OpenAI content
export function extractTextContent(content, separator = "") {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.filter(c => c.type === OPENAI_BLOCK.TEXT).map(c => c.text).join(separator);
  }
  return "";
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

// Visit only actual JSON Schema nodes, never property maps or annotation payloads.
function visitSchemaNodes(schema, visitor) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return;

  visitor(schema);

  for (const keyword of ["properties", "$defs", "definitions", "patternProperties", "dependentSchemas", "dependencies"]) {
    const children = schema[keyword];
    if (children && typeof children === "object" && !Array.isArray(children)) {
      for (const child of Object.values(children)) visitSchemaNodes(child, visitor);
    }
  }

  for (const keyword of ["items", "prefixItems", "allOf", "anyOf", "oneOf"]) {
    const children = schema[keyword];
    if (Array.isArray(children)) {
      for (const child of children) visitSchemaNodes(child, visitor);
    } else if (keyword === "items") {
      visitSchemaNodes(children, visitor);
    }
  }

  for (const keyword of [
    "additionalProperties", "contains", "propertyNames", "if", "then", "else", "not",
    "unevaluatedProperties", "unevaluatedItems", "contentSchema",
  ]) {
    visitSchemaNodes(schema[keyword], visitor);
  }
}

// Remove unsupported keywords from schema nodes.
// Also strips all vendor extension fields (x- prefixed) not supported by Gemini.
function removeUnsupportedKeywords(schema, keywords) {
  visitSchemaNodes(schema, node => {
    for (const key of Object.keys(node)) {
      if (keywords.includes(key) || key.startsWith("x-")) delete node[key];
    }
  });
}

// Convert const to enum
function convertConstToEnum(schema) {
  visitSchemaNodes(schema, node => {
    if (node.const !== undefined && !node.enum) {
      node.enum = [node.const];
      delete node.const;
    }
  });
}

// Convert enum values to strings (Gemini requires string enum values + explicit type:"string")
function convertEnumValuesToStrings(schema) {
  visitSchemaNodes(schema, node => {
    if (node.enum && Array.isArray(node.enum)) {
      node.enum = node.enum.map(v => String(v));
      // Gemini API requires type:"string" when enum is present — without it returns 400
      if (!node.type) node.type = "string";
    }
  });
}

// Merge allOf schemas
function mergeAllOf(schema) {
  visitSchemaNodes(schema, node => {
    if (!node.allOf || !Array.isArray(node.allOf)) return;

    const merged = {};
    for (const item of node.allOf) {
      if (item.properties) {
        if (!merged.properties) merged.properties = {};
        Object.assign(merged.properties, item.properties);
      }
      if (item.required && Array.isArray(item.required)) {
        if (!merged.required) merged.required = [];
        for (const required of item.required) {
          if (!merged.required.includes(required)) merged.required.push(required);
        }
      }
    }

    delete node.allOf;
    if (merged.properties) node.properties = { ...node.properties, ...merged.properties };
    if (merged.required) node.required = [...(node.required || []), ...merged.required];
  });
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
function flattenAnyOfOneOf(schema) {
  visitSchemaNodes(schema, node => {
    if (node.anyOf && Array.isArray(node.anyOf) && node.anyOf.length > 0) {
      const nonNullSchemas = node.anyOf.filter(item => item && item.type !== "null");
      if (nonNullSchemas.length > 0) {
        const selected = nonNullSchemas[selectBest(nonNullSchemas)];
        delete node.anyOf;
        Object.assign(node, selected);
      }
    }

    if (node.oneOf && Array.isArray(node.oneOf) && node.oneOf.length > 0) {
      const nonNullSchemas = node.oneOf.filter(item => item && item.type !== "null");
      if (nonNullSchemas.length > 0) {
        const selected = nonNullSchemas[selectBest(nonNullSchemas)];
        delete node.oneOf;
        Object.assign(node, selected);
      }
    }
  });
}

// Flatten type arrays
function flattenTypeArrays(schema) {
  visitSchemaNodes(schema, node => {
    if (node.type && Array.isArray(node.type)) {
      const nonNullTypes = node.type.filter(type => type !== "null");
      node.type = nonNullTypes.length > 0 ? nonNullTypes[0] : "string";
    }
  });
}

/**
 * Infer missing `type: "object"` on schema nodes that carry `properties` but no
 * explicit `type` (Gemini requires the explicit type).
 *
 * Uses the shared schema-node traversal convention and never visits a
 * property-name dictionary or annotation payload. Mutates `schema` in place.
 *
 * @param {object} schema - JSON Schema node to normalize (mutated in place).
 * @returns {void}
 */
function ensureObjectType(schema) {
  visitSchemaNodes(schema, node => {
    if (node.properties && !node.type) node.type = "object";
  });
}

// Clean JSON Schema for Antigravity API compatibility - removes unsupported keywords recursively
export function cleanJSONSchemaForAntigravity(schema) {
  if (!schema || typeof schema !== "object") return schema;

  // Mutate directly (schema is only used once per request)
  let cleaned = schema;

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

  // Phase 4: Cleanup required fields recursively
  visitSchemaNodes(cleaned, node => {
    if (node.required && Array.isArray(node.required) && node.properties) {
      const validRequired = node.required.filter(field =>
        Object.prototype.hasOwnProperty.call(node.properties, field)
      );
      if (validRequired.length === 0) {
        delete node.required;
      } else {
        node.required = validRequired;
      }
    }
  });

  // Phase 5: Add placeholder for empty object schemas (Antigravity requirement)
  visitSchemaNodes(cleaned, node => {
    // Empty schema {} (no type, no properties) after $ref removal — treat as object with placeholder
    if (Object.keys(node).length === 0) {
      node.type = "object";
      node.properties = {
        reason: {
          type: "string",
          description: "Brief explanation of why you are calling this tool"
        }
      };
      node.required = ["reason"];
      return;
    }

    if (node.type === "object" && (!node.properties || Object.keys(node.properties).length === 0)) {
      node.properties = {
        reason: {
          type: "string",
          description: "Brief explanation of why you are calling this tool"
        }
      };
      node.required = ["reason"];
    }
  });

  return cleaned;
}

