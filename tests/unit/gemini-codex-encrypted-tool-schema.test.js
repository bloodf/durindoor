import { describe, expect, it } from "vitest";
import { cleanJSONSchemaForAntigravity, UNSUPPORTED_SCHEMA_CONSTRAINTS } from "../../open-sse/translator/formats/gemini.js";
import { openaiToGeminiRequest } from "../../open-sse/translator/request/openai-to-gemini.js";

/**
 * Guards port of OmniRoute #10053: Codex's multi-agent collaboration tools
 * (spawn_agent / send_message / followup_task) mark their `message` parameter
 * schema with a non-standard `encrypted: true` annotation
 * (JsonSchema::with_encrypted). `encrypted` was NOT in
 * UNSUPPORTED_SCHEMA_CONSTRAINTS, so cleanJSONSchemaForAntigravity left it in
 * the function-declaration parameters, and Gemini/Antigravity rejects the
 * unrecognized keyword with a hard 400 ("Unknown name \"encrypted\" ...
 * Cannot find field").
 */
describe("UNSUPPORTED_SCHEMA_CONSTRAINTS includes encrypted", () => {
  it("lists encrypted as an unsupported keyword", () => {
    expect(UNSUPPORTED_SCHEMA_CONSTRAINTS).toContain("encrypted");
  });
});

describe("cleanJSONSchemaForAntigravity strips encrypted", () => {
  it("keeps encrypted property names and strips their schema annotations", () => {
    const schema = {
      type: "object",
      properties: {
        encrypted: {
          type: "object",
          encrypted: true,
          properties: {
            encrypted: { type: "string", encrypted: true },
            task_name: { type: "string" }
          },
          required: ["encrypted", "task_name"]
        },
        message: { type: "string", encrypted: true }
      },
      required: ["encrypted", "message"]
    };

    const result = cleanJSONSchemaForAntigravity(schema);

    expect(result.properties.encrypted).toEqual({
      type: "object",
      properties: {
        encrypted: { type: "string" },
        task_name: { type: "string" }
      },
      required: ["encrypted", "task_name"]
    });
    expect(result.required).toEqual(["encrypted", "message"]);
    expect(result.properties.message).toEqual({ type: "string" });
  });
});

describe("OpenAI -> Gemini request strips encrypted from Codex collaboration tool parameters", () => {
  it("never lets encrypted reach the translated function declaration", () => {
    const body = {
      messages: [{ role: "user", content: "hi" }],
      tools: [
        {
          type: "function",
          function: {
            name: "collaboration.send_message",
            description: "send",
            parameters: {
              type: "object",
              properties: {
                message: { type: "string", description: "Message text", encrypted: true },
                recipient: { type: "string" }
              },
              required: ["message", "recipient"]
            }
          }
        }
      ]
    };

    const result = openaiToGeminiRequest("gemini-3.5-flash-low", body, false);
    const parameters = result.tools?.[0]?.functionDeclarations?.[0]?.parameters;

    expect(parameters).toBeDefined();
    expect(parameters.properties.recipient).toEqual({ type: "string" });
    expect(JSON.stringify(parameters)).not.toContain("encrypted");
  });
});
