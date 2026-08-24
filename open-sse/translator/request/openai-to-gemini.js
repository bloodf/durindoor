import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { DEFAULT_THINKING_AG_SIGNATURE, DEFAULT_THINKING_GEMINI_CLI_SIGNATURE } from "../../config/defaultThinkingSignature.js";
import { openaiToClaudeRequestForAntigravity } from "./openai-to-claude.js";
import { isObject, isString } from "@/shared/utils/typeChecks.js";
function generateUUID() {
  return crypto.randomUUID();
}

import {
  DEFAULT_SAFETY_SETTINGS,
  convertOpenAIContentToParts,
  extractTextContent,
  tryParseJSON,
  sanitizeFunctionResponseResult,
  generateRequestId,
  generateSessionId,
  generateProjectId,
  cleanJSONSchemaForAntigravity } from
"../formats/gemini.js";
import { parseDataUri } from "../concerns/image.js";
import { deriveSessionId, toNumericSessionId } from "../../utils/sessionManager.js";
import { ROLE, GEMINI_ROLE, OPENAI_BLOCK, CLAUDE_BLOCK } from "../schema/index.js";

// Sanitize function names for Gemini API.
// Gemini requires: starts with [a-zA-Z_], followed by [a-zA-Z0-9_.:\-], max 64 chars.
// Replace any invalid character with '_' and truncate to 64.
function sanitizeGeminiFunctionName(name) {
  if (!name) return "_unknown";
  // Replace any char not in [a-zA-Z0-9_.:\-] with '_'
  let sanitized = name.replace(/[^a-zA-Z0-9_.:\-]/g, "_");
  // First char must be letter or underscore
  if (!/^[a-zA-Z_]/.test(sanitized)) {
    sanitized = "_" + sanitized;
  }
  // Truncate to 64 chars
  return sanitized.substring(0, 64);
}

/**
 * Keep Gemini history legal by isolating function responses and ensuring a
 * terminal user turn. Ported from decolua/9router#3055.
 */
function normalizeGeminiContents(contents) {
  const out = [];
  for (const c of contents || []) {
    if (!c?.role || !Array.isArray(c.parts) || c.parts.length === 0) continue;
    const last = out.at(-1);
    if (last?.role === c.role) {
      const lastHasFunctionResponse = last.parts.some((part) => part?.functionResponse);
      const currentHasFunctionResponse = c.parts.some((part) => part?.functionResponse);
      const lastHasText = last.parts.some((part) => part?.text);
      const currentHasText = c.parts.some((part) => part?.text);

      if (
      c.role === GEMINI_ROLE.USER && (
      lastHasFunctionResponse && currentHasText || lastHasText && currentHasFunctionResponse))
      {
        out.push({ ...c, parts: [...c.parts] });
      } else {
        last.parts.push(...c.parts);
      }
    } else {
      out.push({ ...c, parts: [...c.parts] });
    }
  }

  if (out.at(-1)?.role === GEMINI_ROLE.MODEL) {
    const functionCalls = out.at(-1).parts.filter((part) => part?.functionCall);
    out.push({
      role: GEMINI_ROLE.USER,
      parts: functionCalls.length > 0 ?
      functionCalls.map(({ functionCall }) => ({
        functionResponse: {
          ...(functionCall.id ? { id: functionCall.id } : null),
          name: functionCall.name,
          response: { result: "No response provided" }
        }
      })) :
      [{ text: "Continue" }]
    });
  }

  return out;
}

/**
 * Core OpenAI→Gemini request translator (base for all Gemini variants).
 *
 * Gemma 4 on the Gemini API rejects replayed synthetic thought parts and
 * `thoughtSignature` on `functionCall` history parts (generic INVALID_ARGUMENT),
 * so for `gemma-4*` models we drop `reasoning_content` replay and omit the
 * synthetic thought signature from tool-call history. Other Gemini models keep
 * both for Antigravity/Gemini replay.
 * decolua/9router#3055 also treats an explicitly empty tool result as present;
 * Gemini must receive its functionResponse instead of dropping it as falsy.
 *
 * @param {string} model - Target Gemini model id.
 * @param {object} body - OpenAI-shaped request body.
 * @param {boolean} stream - Whether the caller requested streaming.
 * @param {string} [signature] - Synthetic thought signature to attach to replayed tool calls.
 * @returns {object} Gemini-shaped generateContent request.
 */
function openaiToGeminiBase(model, body, stream, signature = DEFAULT_THINKING_AG_SIGNATURE) {
  const isGemma4 = isString(model) && /gemma-4/i.test(model);
  const result = {
    model: model,
    contents: [],
    generationConfig: {},
    safetySettings: DEFAULT_SAFETY_SETTINGS
  };

  // Generation config
  if (body.temperature !== undefined) {
    result.generationConfig.temperature = body.temperature;
  }
  if (body.top_p !== undefined) {
    result.generationConfig.topP = body.top_p;
  }
  if (body.top_k !== undefined) {
    result.generationConfig.topK = body.top_k;
  }
  if (body.max_tokens !== undefined) {
    result.generationConfig.maxOutputTokens = body.max_tokens;
  }

  // Build tool_call_id -> name map
  const tcID2Name = {};
  if (body.messages && Array.isArray(body.messages)) {
    for (const msg of body.messages) {
      if (msg.role === ROLE.ASSISTANT && msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          if (tc.type === OPENAI_BLOCK.FUNCTION && tc.id && tc.function?.name) {
            tcID2Name[tc.id] = tc.function.name;
          }
        }
      }
    }
  }

  // Build tool responses cache
  const toolResponses = {};
  if (body.messages && Array.isArray(body.messages)) {
    for (const msg of body.messages) {
      if (msg.role === ROLE.TOOL && msg.tool_call_id) {
        toolResponses[msg.tool_call_id] = msg.content;
      }
    }
  }

  // Convert messages
  if (body.messages && Array.isArray(body.messages)) {
    for (let i = 0; i < body.messages.length; i++) {
      const msg = body.messages[i];
      const role = msg.role;
      const content = msg.content;

      if (role === ROLE.SYSTEM && body.messages.length > 1) {
        result.systemInstruction = {
          role: GEMINI_ROLE.USER,
          parts: [{ text: isString(content) ? content : extractTextContent(content) }]
        };
      } else if (role === ROLE.USER || role === ROLE.SYSTEM && body.messages.length === 1) {
        const parts = convertOpenAIContentToParts(content);
        if (parts.length > 0) {
          result.contents.push({ role: GEMINI_ROLE.USER, parts });
        }
      } else if (role === ROLE.ASSISTANT) {
        const parts = [];

        // Thinking/reasoning → thought part with signature.
        // Gemma 4 rejects replayed synthetic thought parts in multi-turn history.
        if (msg.reasoning_content && !isGemma4) {
          parts.push({
            thought: true,
            text: msg.reasoning_content
          });
          parts.push({
            thoughtSignature: signature,
            text: ""
          });
        }

        if (content) {
          const text = isString(content) ? content : extractTextContent(content);
          if (text) {
            parts.push({ text });
          }
        }

        if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
          const toolCallIds = [];
          for (const tc of msg.tool_calls) {
            if (tc.type !== OPENAI_BLOCK.FUNCTION) continue;

            const args = tryParseJSON(tc.function?.arguments || "{}");
            const functionCallPart = {
              functionCall: {
                id: tc.id,
                name: sanitizeGeminiFunctionName(tc.function.name),
                args: args
              }
            };
            // Synthetic thought signatures are useful for Gemini/Antigravity
            // replay, but Gemma 4 on Gemini API rejects them on functionCall
            // history parts with a generic INVALID_ARGUMENT.
            if (!isGemma4) functionCallPart.thoughtSignature = signature;
            parts.push(functionCallPart);
            toolCallIds.push(tc.id);
          }

          if (parts.length > 0) {
            result.contents.push({ role: GEMINI_ROLE.MODEL, parts });
          }

          // Check if there are actual tool responses in the next messages
          const hasActualResponses = toolCallIds.some((fid) => toolResponses[fid] !== undefined);

          if (hasActualResponses) {
            const toolParts = [];
            for (const fid of toolCallIds) {
              if (toolResponses[fid] === undefined) continue;

              let name = tcID2Name[fid];
              if (!name) {
                // Generated ids encode the name: `name_<ts>_<idx>` (current) or
                // `name-<ts>-<idx>` (legacy). Foreign ids (toolu_..., upstream
                // functionCall.id) don't — fall back to the id itself, as before.
                const m = fid.match(/^(.+?)[-_]\d{10,}[-_]\d+$/);
                name = m ? m[1] : fid;
              }

              let resp = toolResponses[fid];
              let parsedResp = sanitizeFunctionResponseResult(tryParseJSON(resp));
              if (parsedResp === null) {
                parsedResp = { result: resp };
              } else if (!isObject(parsedResp)) {
                parsedResp = { result: parsedResp };
              }

              toolParts.push({
                functionResponse: {
                  id: fid,
                  name: sanitizeGeminiFunctionName(name),
                  response: { result: parsedResp }
                }
              });
            }
            if (toolParts.length > 0) {
              result.contents.push({ role: GEMINI_ROLE.USER, parts: toolParts });
            }
          }
        } else if (parts.length > 0) {
          result.contents.push({ role: GEMINI_ROLE.MODEL, parts });
        }
      }
    }
  }

  // Convert tools
  if (body.tools && Array.isArray(body.tools) && body.tools.length > 0) {
    const functionDeclarations = [];
    for (const t of body.tools) {
      // Check if already in Anthropic/Claude format (no type field, direct name/description/input_schema)
      if (t.name && t.input_schema) {
        const cleanedSchema = cleanJSONSchemaForAntigravity(structuredClone(t.input_schema || { type: "object", properties: {} }));
        functionDeclarations.push({
          name: sanitizeGeminiFunctionName(t.name),
          description: t.description || "",
          parameters: cleanedSchema
        });
      }
      // OpenAI format
      else if (t.type === OPENAI_BLOCK.FUNCTION && t.function) {
        const fn = t.function;
        const cleanedSchema = cleanJSONSchemaForAntigravity(structuredClone(fn.parameters || { type: "object", properties: {} }));
        functionDeclarations.push({
          name: sanitizeGeminiFunctionName(fn.name),
          description: fn.description || "",
          parameters: cleanedSchema
        });
      }
    }

    if (functionDeclarations.length > 0) {
      result.tools = [{ functionDeclarations }];
    }
  }

  result.contents = normalizeGeminiContents(result.contents);
  return result;
}

// OpenAI -> Gemini (standard API)
export function openaiToGeminiRequest(model, body, stream) {
  return openaiToGeminiBase(model, body, stream);
}

function omitGemma4ThinkingConfig(model, body) {
  if (model.startsWith("gemma-4")) delete body.generationConfig?.thinkingConfig;
  return body;
}
openaiToGeminiRequest.finalize = omitGemma4ThinkingConfig;

// OpenAI -> Gemini CLI (Cloud Code Assist)
export function openaiToGeminiCLIRequest(model, body, stream) {
  const gemini = openaiToGeminiBase(model, body, stream, DEFAULT_THINKING_GEMINI_CLI_SIGNATURE);
  // Thinking is normalized centrally by applyThinking (thinkingUnified.js) after translation.

  // Clean schema for tools
  if (gemini.tools?.[0]?.functionDeclarations) {
    for (const fn of gemini.tools[0].functionDeclarations) {
      if (fn.parameters) {
        const cleanedSchema = cleanJSONSchemaForAntigravity(fn.parameters);
        fn.parameters = cleanedSchema;
        // if (isClaude) {
        //   fn.parameters = cleanedSchema;
        // } else {
        //   fn.parametersJsonSchema = cleanedSchema;
        //   delete fn.parameters;
        // }
      }
    }
  }

  return gemini;
}

// Wrap Gemini CLI format in Cloud Code wrapper
function wrapInCloudCodeEnvelope(model, geminiCLI, credentials = null, isAntigravity = false) {
  const projectId = credentials?.projectId || generateProjectId();

  const envelope = {
    project: projectId,
    model: model,
    userAgent: isAntigravity ? "antigravity" : "gemini-cli",
    requestId: isAntigravity ? `agent-${generateUUID()}` : generateRequestId(),
    request: {
      sessionId: toNumericSessionId(credentials?._clientSessionId) || (isAntigravity ? deriveSessionId(credentials?.email || credentials?.connectionId) : generateSessionId()),
      contents: geminiCLI.contents,
      systemInstruction: geminiCLI.systemInstruction,
      generationConfig: geminiCLI.generationConfig,
      tools: geminiCLI.tools
    }
  };

  // Antigravity specific fields
  if (isAntigravity) {
    envelope.requestType = "agent";
  } else {
    // Keep safetySettings for Gemini CLI
    envelope.request.safetySettings = geminiCLI.safetySettings;
  }

  if (geminiCLI.tools?.length > 0) {
    envelope.request.toolConfig = {
      functionCallingConfig: { mode: "VALIDATED" }
    };
  }

  return envelope;
}

// Wrap Claude format in Cloud Code envelope for Antigravity
function wrapInCloudCodeEnvelopeForClaude(model, claudeRequest, credentials = null, signature = DEFAULT_THINKING_AG_SIGNATURE) {
  const projectId = credentials?.projectId || generateProjectId();

  const envelope = {
    project: projectId,
    model: model,
    userAgent: "antigravity",
    requestId: `agent-${generateUUID()}`,
    requestType: "agent",
    request: {
      sessionId: toNumericSessionId(credentials?._clientSessionId) || deriveSessionId(credentials?.email || credentials?.connectionId),
      contents: [],
      generationConfig: {
        temperature: claudeRequest.temperature || 1,
        maxOutputTokens: claudeRequest.max_tokens || 4096
      }
    }
  };

  // Build tool_use id -> name map so functionResponse can use the correct name
  const toolUseIdToName = {};
  if (claudeRequest.messages && Array.isArray(claudeRequest.messages)) {
    for (const msg of claudeRequest.messages) {
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === CLAUDE_BLOCK.TOOL_USE && block.id && block.name) {
            toolUseIdToName[block.id] = block.name;
          }
        }
      }
    }
  }

  // Convert Claude messages to Gemini contents
  if (claudeRequest.messages && Array.isArray(claudeRequest.messages)) {
    for (const msg of claudeRequest.messages) {
      const parts = [];

      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === CLAUDE_BLOCK.TEXT) {
            parts.push({ text: block.text });
          } else if (block.type === CLAUDE_BLOCK.IMAGE && block.source?.type === "base64") {
            parts.push({
              inlineData: {
                mimeType: block.source.media_type || "image/png",
                data: block.source.data
              }
            });
          } else if (block.type === CLAUDE_BLOCK.TOOL_USE) {
            parts.push({
              thoughtSignature: signature,
              functionCall: {
                id: block.id,
                name: sanitizeGeminiFunctionName(block.name),
                args: block.input || {}
              }
            });
          } else if (block.type === CLAUDE_BLOCK.TOOL_RESULT) {
            let content = block.content;
            const imageParts = [];
            if (Array.isArray(content)) {
              const textItems = [];
              for (const item of content) {
                if (item.type === CLAUDE_BLOCK.IMAGE && item.source?.type === "base64") {
                  imageParts.push({
                    inlineData: {
                      mimeType: item.source.media_type || "image/png",
                      data: item.source.data
                    }
                  });
                } else if (item.type === "image_url" && item.image_url?.url) {
                  const parsed = parseDataUri(item.image_url.url);
                  if (parsed) {
                    imageParts.push({
                      inlineData: {
                        mimeType: parsed.mimeType || "image/png",
                        data: parsed.base64
                      }
                    });
                  }
                } else if (item.type === CLAUDE_BLOCK.TEXT) {
                  textItems.push(item.text);
                }
              }
              content = textItems.join("\n");
            }
            // Resolve the original tool name from the id — Gemini requires it to match the functionCall name
            const resolvedName = toolUseIdToName[block.tool_use_id] ?
            sanitizeGeminiFunctionName(toolUseIdToName[block.tool_use_id]) :
            "tool";
            const functionResponse = {
              id: block.tool_use_id,
              name: resolvedName,
              response: { result: sanitizeFunctionResponseResult(tryParseJSON(content)) || content }
            };
            if (imageParts.length > 0) functionResponse.parts = imageParts;
            parts.push({ functionResponse });
          }
        }
      } else if (isString(msg.content)) {
        parts.push({ text: msg.content });
      }

      if (parts.length > 0) {
        envelope.request.contents.push({
          role: msg.role === ROLE.ASSISTANT ? GEMINI_ROLE.MODEL : GEMINI_ROLE.USER,
          parts
        });
      }
    }
  }

  // Convert Claude tools to Gemini functionDeclarations
  if (claudeRequest.tools && Array.isArray(claudeRequest.tools)) {
    const functionDeclarations = [];
    for (const tool of claudeRequest.tools) {
      if (tool.name && tool.input_schema) {
        const cleanedSchema = cleanJSONSchemaForAntigravity(tool.input_schema);
        functionDeclarations.push({
          name: sanitizeGeminiFunctionName(tool.name),
          description: tool.description || "",
          parameters: cleanedSchema
        });
      }
    }
    if (functionDeclarations.length > 0) {
      envelope.request.tools = [{ functionDeclarations }];
      envelope.request.toolConfig = {
        functionCallingConfig: { mode: "VALIDATED" }
      };
    }
  }

  const systemParts = [];
  // Merge user system prompt from claudeRequest
  if (claudeRequest.system) {
    if (Array.isArray(claudeRequest.system)) {
      for (const block of claudeRequest.system) {
        if (block.text) systemParts.push({ text: block.text });
      }
    } else if (isString(claudeRequest.system)) {
      systemParts.push({ text: claudeRequest.system });
    }
  }

  if (systemParts.length > 0) {
    envelope.request.systemInstruction = { role: GEMINI_ROLE.USER, parts: systemParts };
  }

  envelope.request.contents = normalizeGeminiContents(envelope.request.contents);
  return envelope;
}

// Detect if model should use Claude backend in Antigravity
// Claude models have specific ID patterns — more reliable than caps at routing level
function isClaudeModel(model) {
  return model.toLowerCase().includes("claude");
}

// OpenAI -> Antigravity (Sandbox Cloud Code with wrapper)
export function openaiToAntigravityRequest(model, body, stream, credentials = null) {
  if (isClaudeModel(model)) {
    const claudeRequest = openaiToClaudeRequestForAntigravity(model, body, stream);
    return wrapInCloudCodeEnvelopeForClaude(model, claudeRequest, credentials);
  }

  const geminiCLI = openaiToGeminiCLIRequest(model, body, stream);
  return wrapInCloudCodeEnvelope(model, geminiCLI, credentials, true);
}

// Register
register(FORMATS.OPENAI, FORMATS.GEMINI, openaiToGeminiRequest, null);
register(FORMATS.OPENAI, FORMATS.GEMINI_CLI, (model, body, stream, credentials) => wrapInCloudCodeEnvelope(model, openaiToGeminiCLIRequest(model, body, stream), credentials), null);
register(FORMATS.OPENAI, FORMATS.ANTIGRAVITY, openaiToAntigravityRequest, null);