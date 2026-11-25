import { describe, expect, it } from "vitest";

import { toClaudeInputSchema } from "../../open-sse/translator/concerns/claudeInputSchema.js";

const text = { type: "string" };
const object = (properties, required) => ({ type: "object", properties, ...(required && { required }) });
const ref = (name) => ({ $ref: `#/$defs/${name}` });
const flatten = (schema) => toClaudeInputSchema(schema, undefined, "tool");

// Each definition references the next one twice: 2^depth expansions unmemoized.
function doubledDag(depth, keyword, extra = {}) {
  const $defs = { [`d${depth}`]: object({ leaf: text }, ["leaf"]) };
  for (let i = 0; i < depth; i += 1) {
    $defs[`d${i}`] = { [keyword]: [{ ...ref(`d${i + 1}`), ...extra }, { ...ref(`d${i + 1}`), ...extra }] };
  }
  return { $defs, [keyword]: [ref("d0"), ref("d0")] };
}

function timed(schema) {
  const start = performance.now();
  const result = flatten(schema);
  return { result, ms: performance.now() - start };
}

describe("#2571 - bounded $ref expansion", () => {
  it.each(["allOf", "anyOf", "oneOf"])("expands a doubled %s DAG quickly", (keyword) => {
    // Depth 18 goes first: unmemoized code fails here instead of hanging on 30.
    for (const depth of [18, 30]) {
      const { result, ms } = timed(doubledDag(depth, keyword));
      expect(ms).toBeLessThan(100);
      expect(result.properties).toEqual({ leaf: text });
      expect(result.required).toEqual(["leaf"]);
    }
  });

  it("stays fast when every reference carries sibling keywords", () => {
    const { result, ms } = timed(doubledDag(30, "allOf", { title: "t" }));
    expect(ms).toBeLessThan(100);
    expect(result.properties).toEqual({ leaf: text });
  });

  it("does not multiply merged property schemas through shared definitions", () => {
    const $defs = { l30: object({ p: text }), r30: object({ p: { type: "number" } }) };
    for (let i = 0; i < 30; i += 1) {
      const next = [ref(`l${i + 1}`), ref(`r${i + 1}`)];
      $defs[`l${i}`] = { allOf: next, properties: { p: { title: `l${i}` } } };
      $defs[`r${i}`] = { anyOf: next, properties: { p: { title: `r${i}` } } };
    }
    const { result, ms } = timed({ $defs, anyOf: [ref("l0"), ref("r0")] });
    expect(ms).toBeLessThan(500);
    expect(JSON.stringify(result).length).toBeLessThan(2_000_000);
  });

  it.each([
    ["too deep", doubledDag(40, "allOf")],
    ["too many variants", { anyOf: Array.from({ length: 5000 }, (_, i) => object({ [`p${i}`]: text })) }],
    ["a long reference chain", {
      $defs: Object.fromEntries(Array.from({ length: 20000 }, (_, i) => [`c${i}`, ref(`c${i + 1}`)])),
      anyOf: [ref("c0")]
    }]
  ])("returns a safe open object schema when %s", (_label, source) => {
    const schema = { ...source, properties: { own: text }, required: ["own"], additionalProperties: false };
    const copy = structuredClone(schema);
    const { result, ms } = timed(schema);
    expect(ms).toBeLessThan(500);
    expect(result).toMatchObject({ type: "object", properties: { own: text }, required: ["own"] });
    expect(result.allOf ?? result.anyOf ?? result.additionalProperties).toBeUndefined();
    expect(result.description).toContain("omitted");
    expect(schema).toEqual(copy);
  });

  it("terminates on densely cyclic definitions", () => {
    const names = Array.from({ length: 12 }, (_, i) => `n${i}`);
    const $defs = Object.fromEntries(names.map((name) => [name, { anyOf: names.map(ref) }]));
    const { result, ms } = timed({ $defs, anyOf: names.map(ref) });
    expect(ms).toBeLessThan(500);
    expect(result).toMatchObject({ type: "object", properties: {} });
    expect(result.anyOf).toBeUndefined();
  });

  it("does not throw on a non-array required inside a variant", () => {
    expect(flatten({ anyOf: [{ required: 5 }] })).toEqual({ type: "object", properties: {} });
  });
});

describe("#2571 - union argument dependencies", () => {
  it("keeps both requirements of a union with different required fields", () => {
    const result = flatten({ description: "Find.", oneOf: [object({ path: text }, ["path"]), object({ url: text }, ["url"])] });
    expect(result.properties).toEqual({ path: text, url: text });
    expect(result.required).toBeUndefined();
    expect(result.description).toMatch(/^Find\.\n\n.*oneOf.*requires path;.*requires url;/);
  });

  it("keeps which discriminator value needs which field", () => {
    const action = (value) => ({ type: "string", const: value });
    const result = flatten({ anyOf: [
      object({ action: action("write"), body: text }, ["action", "body"]),
      object({ action: action("read") }, ["action"])
    ] });
    expect(result.required).toEqual(["action"]);
    expect(result.properties.action).toEqual({ anyOf: [action("write"), action("read")] });
    expect(result.description).toContain(`requires action, body where action=${JSON.stringify(action("write"))}`);
  });

  it("keeps a union nested under allOf", () => {
    const result = flatten({ allOf: [{ anyOf: [object({ a: text }, ["a"]), object({ b: text }, ["b"])] }] });
    expect(result.description).toContain("requires a;");
    expect(result.description).toContain("requires b;");
  });

  it("adds no description when the union merges cleanly", () => {
    const result = flatten({ anyOf: [object({ a: text, id: text }, ["a", "id"]), object({ id: text }, ["id"])] });
    expect(result.description).toBeUndefined();
    expect(result.required).toEqual(["id"]);
  });
});
