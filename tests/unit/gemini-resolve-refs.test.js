import { describe, expect, it } from "vitest";
import { cleanJSONSchemaForAntigravity } from "../../open-sse/translator/formats/gemini.js";

describe("cleanJSONSchemaForAntigravity — $ref resolution", () => {
  it("inlines local $defs references and strips the definitions container", () => {
    const schema = {
      type: "object",
      properties: {
        address: { $ref: "#/$defs/Address" }
      },
      $defs: {
        Address: {
          type: "object",
          properties: {
            street: { type: "string" },
            city: { type: "string" }
          },
          required: ["street", "city"]
        }
      }
    };

    cleanJSONSchemaForAntigravity(schema);

    expect(schema.properties.address).toEqual({
      type: "object",
      properties: {
        street: { type: "string" },
        city: { type: "string" }
      },
      required: ["street", "city"]
    });
    expect(schema).not.toHaveProperty("$defs");
    expect(schema.properties.address).not.toHaveProperty("$ref");
  });

  it("resolves #/definitions/ paths (JSON Schema draft-07 style)", () => {
    const schema = {
      type: "object",
      properties: {
        contact: { $ref: "#/definitions/Contact" }
      },
      definitions: {
        Contact: { type: "string", description: "phone" }
      }
    };

    cleanJSONSchemaForAntigravity(schema);

    expect(schema.properties.contact).toEqual({ type: "string", description: "phone" });
    expect(schema).not.toHaveProperty("definitions");
  });

  it("replaces an unresolvable $ref with a safe string placeholder", () => {
    const schema = {
      type: "object",
      properties: {
        missing: { $ref: "#/$defs/Nope" }
      },
      $defs: {}
    };

    cleanJSONSchemaForAntigravity(schema);

    expect(schema.properties.missing).toEqual({ type: "string", description: "(unresolved reference)" });
  });

  it("does not recurse infinitely on a circular $ref", () => {
    const schema = {
      $defs: {
        Node: {
          type: "object",
          properties: { child: { $ref: "#/$defs/Node" } }
        }
      },
      type: "object",
      properties: { root: { $ref: "#/$defs/Node" } }
    };

    expect(() => cleanJSONSchemaForAntigravity(schema)).not.toThrow();
    expect(schema.properties.root.type).toBe("object");
    expect(schema).not.toHaveProperty("$defs");
  });
});
