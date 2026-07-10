import { describe, expect, it } from "vitest";
import { cleanJSONSchemaForAntigravity } from "../../open-sse/translator/formats/gemini.js";
import { antigravityToOpenAIRequest } from "../../open-sse/translator/request/antigravity-to-openai.js";

/**
 * Guards upstream decolua/9router#2222:
 *   fix(antigravity): fix 400 Bad Request caused by invalid type injection in nested schema
 *
 * Two coupled fixes:
 *   (a) gemini.js ensureObjectType must recurse only into real schema nodes
 *       (`properties` map values + `items`), never blindly into Object.values(obj).
 *       Otherwise a schema property literally named "properties" makes the
 *       properties-map dictionary look like a schema node and gain type:"object",
 *       so one property value becomes the literal string "object" -> Gemini 400.
 *   (b) antigravity-to-openai.js normalizeSchemaTypes must also recurse into
 *       additionalProperties and add a placeholder `properties` for bare
 *       type:"object" nodes (Gemini rejects type:object without properties).
 */
describe("#2222 nested schema type injection", () => {
  describe("cleanJSONSchemaForAntigravity — ensureObjectType recurses only into schema nodes", () => {
    it("does not inject type into a properties-map dictionary keyed 'properties'", () => {
      // A schema that has a property whose NAME is "properties". The buggy
      // Object.values(obj) walk would treat the inner properties-map as a schema
      // node and stamp type:"object" on it, corrupting a sibling value.
      const schema = {
        type: "object",
        properties: {
          properties: {
            // a real nested schema node named "properties"
            type: "object",
            properties: {
              id: { type: "string" }
            }
          },
          name: { type: "string" }
        }
      };

      cleanJSONSchemaForAntigravity(schema);

      // The top-level properties-map must NOT gain its own `type`.
      expect(schema.properties).not.toHaveProperty("type");
      // Every value in the map must remain a schema object, never the string "object".
      for (const val of Object.values(schema.properties)) {
        expect(val).toBeTypeOf("object");
        expect(val).not.toBe("object");
      }
    });

    it("still infers type:object on a nested schema node that has properties", () => {
      const schema = {
        type: "object",
        properties: {
          nested: {
            // missing type, but has properties -> must be inferred object
            properties: { id: { type: "string" } }
          }
        }
      };
      cleanJSONSchemaForAntigravity(schema);
      expect(schema.properties.nested.type).toBe("object");
    });

    it("recurses into array items and infers type:object there", () => {
      const schema = {
        type: "object",
        properties: {
          rows: {
            type: "array",
            items: {
              // missing type, has properties -> must be inferred object
              properties: { id: { type: "string" } }
            }
          }
        }
      };
      cleanJSONSchemaForAntigravity(schema);
      expect(schema.properties.rows.items.type).toBe("object");
    });
  });

  describe("antigravityToOpenAIRequest — normalizeSchemaTypes", () => {
    const build = (parameters) =>
      antigravityToOpenAIRequest("gemini-2.5-pro", {
        contents: [{ role: "user", parts: [{ text: "hi" }] }],
        tools: [{ functionDeclarations: [{ name: "t", description: "", parameters }] }]
      });

    it("lowercases a nested additionalProperties.type (OBJECT -> object)", () => {
      const out = build({
        type: "object",
        properties: {
          meta: {
            type: "OBJECT",
            additionalProperties: { type: "OBJECT" }
          }
        }
      });
      const meta = out.tools[0].function.parameters.properties.meta;
      expect(meta.type).toBe("object");
      expect(meta.additionalProperties.type).toBe("object");
    });

    it("adds placeholder properties for a bare type:object node", () => {
      const out = build({
        type: "object",
        properties: {
          blob: { type: "object" } // no properties -> Gemini rejects without placeholder
        }
      });
      const blob = out.tools[0].function.parameters.properties.blob;
      expect(blob.type).toBe("object");
      expect(blob.properties).toBeDefined();
      expect(Object.keys(blob.properties).length).toBeGreaterThan(0);
    });
  });
});
