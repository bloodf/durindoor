import { describe, it, expect } from "vitest";
import { stripUnsupportedParams } from "../../open-sse/translator/concerns/paramSupport.js";
import { normalizeToolSchemaRoots } from "../../open-sse/translator/validate.js";
import { isImageOnlyModel } from "../../src/sse/handlers/chat.js";

// ---- #6597 (OmniRoute #6390): Cloudflare Workers AI must refuse non-text ----
// content parts instead of silently mapping them to "" and dropping the image.
describe("#6597 cloudflare-ai flattenContent rejects non-text parts", () => {
  it("throws a clear error on an image_url content part", () => {
    const body = {
      model: "@cf/meta/llama-3.3-70b-instruct",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "describe this image" },
            { type: "image_url", image_url: { url: "https://example.com/cat.png" } },
          ],
        },
      ],
    };
    expect(() => stripUnsupportedParams("cloudflare-ai", body.model, body)).toThrow(
      /does not accept image|non-text content/i,
    );
  });

  it("still flattens plain text-part messages (no regression)", () => {
    const body = {
      model: "@cf/meta/llama-3.3-70b-instruct",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "hello " },
            { type: "text", text: "world" },
          ],
        },
        { role: "assistant", content: "plain stays plain" },
      ],
    };
    stripUnsupportedParams("cloudflare-ai", body.model, body);
    expect(body.messages[0].content).toBe("hello world");
    expect(body.messages[1].content).toBe("plain stays plain");
  });

  it("does not throw for non-cloudflare providers with image parts", () => {
    const body = {
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "x" },
            { type: "image_url", image_url: { url: "https://example.com/a.png" } },
          ],
        },
      ],
    };
    expect(() => stripUnsupportedParams("openai", body.model, body)).not.toThrow();
  });
});

// ---- #6375 (OmniRoute #6359): root tool schema type coercion -----------------
describe("#6375 normalizeToolSchemaRoots coerces root type:null/missing", () => {
  it("coerces Chat Completions tool.function.parameters type:null -> object", () => {
    const body = {
      tools: [
        {
          type: "function",
          function: {
            name: "codex_app__automation_update",
            parameters: {
              type: null,
              properties: { schedule: { type: "string" } },
              required: ["schedule"],
            },
          },
        },
      ],
    };
    normalizeToolSchemaRoots(body);
    const p = body.tools[0].function.parameters;
    expect(p.type).toBe("object");
    expect(p.properties.schedule).toEqual({ type: "string" });
    // existing properties preserved -> no additionalProperties injection
    expect(p.additionalProperties).toBeUndefined();
  });

  it("adds type:object + properties + additionalProperties when root has neither", () => {
    const body = {
      tools: [{ type: "function", function: { name: "x", parameters: {} } }],
    };
    normalizeToolSchemaRoots(body);
    const p = body.tools[0].function.parameters;
    expect(p.type).toBe("object");
    expect(p.properties).toEqual({});
    expect(p.additionalProperties).toBe(true);
  });

  it("coerces Responses flattened tool.parameters type:null -> object", () => {
    const body = {
      tools: [{ type: "function", name: "y", parameters: { type: null, properties: {} } }],
    };
    normalizeToolSchemaRoots(body);
    expect(body.tools[0].parameters.type).toBe("object");
  });

  it("does not inject a root type on a combinator root (anyOf)", () => {
    const body = {
      tools: [
        {
          type: "function",
          function: {
            name: "z",
            parameters: { anyOf: [{ type: "object", properties: {} }] },
          },
        },
      ],
    };
    normalizeToolSchemaRoots(body);
    expect(body.tools[0].function.parameters.type).toBeUndefined();
  });

  it("drops a null type on a combinator root without injecting object (own-property)", () => {
    const body = {
      tools: [
        {
          type: "function",
          function: {
            name: "w",
            parameters: { type: null, anyOf: [{ type: "object" }] },
          },
        },
      ],
    };
    normalizeToolSchemaRoots(body);
    const p = body.tools[0].function.parameters;
    expect(p.type).toBeUndefined();
    expect(p.anyOf).toEqual([{ type: "object" }]);
  });

  it("leaves an explicit root type untouched", () => {
    const body = {
      tools: [
        {
          type: "function",
          function: { name: "v", parameters: { type: "object", properties: { b: { type: "boolean" } } } },
        },
      ],
    };
    normalizeToolSchemaRoots(body);
    expect(body.tools[0].function.parameters.type).toBe("object");
  });

  it("is a no-op when tools is absent", () => {
    expect(normalizeToolSchemaRoots({ model: "x" })).toEqual({ model: "x" });
    expect(normalizeToolSchemaRoots(null)).toBe(null);
  });
});

// ---- #6525 (OmniRoute #6457): image-only model guard predicate ---------------
// HTTP hook placement (400 + zero handleChatCore calls) is covered by
// omniroute-image-guard-http.test.js; here we pin the registry lookup semantics.
describe("#6525 isImageOnlyModel registry lookup", () => {
  it("returns true for a registry image model (cloudflare-ai flux-2-dev)", () => {
    expect(isImageOnlyModel("cloudflare-ai", "@cf/black-forest-labs/flux-2-dev")).toBe(true);
  });

  it("returns false for a cloudflare-ai chat model (mixed provider)", () => {
    expect(isImageOnlyModel("cloudflare-ai", "@cf/meta/llama-3.3-70b-instruct")).toBe(false);
  });

  it("returns false for a chat model", () => {
    expect(isImageOnlyModel("openai", "gpt-4o")).toBe(false);
  });

  it("returns false for an unknown provider/model (fail open)", () => {
    expect(isImageOnlyModel("does-not-exist", "nope")).toBe(false);
  });
});
