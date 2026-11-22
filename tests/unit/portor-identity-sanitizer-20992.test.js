import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  isIdentitySanitizerEnabled,
  sanitizeIdentity as sanitizeWith,
  sanitizeText,
} from "../../open-sse/services/identitySanitizer.js";

const ON = { DURINDOOR_SANITIZE_IDENTITY: "1" };
const sanitizeIdentity = (b) => sanitizeWith(b, ON);

const P =
  "You are a personal assistant running inside OpenClaw. ## OpenClaw Control\n<!-- openclaw:attempt:STABLE -->\nsee https://docs.openclaw.ai/x via DurinDoor run `openclaw gateway status` in /home/m/.openclaw/a";
const schema = {
  type: "object",
  required: ["id"],
  properties: { description: { type: "string", description: "OpenClaw id" } },
};
const clone = (o) => JSON.parse(JSON.stringify(o));
const stripDesc = (o) =>
  JSON.parse(JSON.stringify(o, (k, v) => (k === "description" && typeof v === "string" ? "" : v)));

const gemTools = [{ functionDeclarations: [{ name: "x", description: "OpenClaw", parameters: schema }] }];
const formats = {
  openai: {
    messages: [
      { role: "system", content: P },
      { role: "user", content: "OpenClaw" },
    ],
    tools: [{ type: "function", function: { name: "openclaw", description: "Via OpenClaw.", parameters: schema } }],
  },
  claude: {
    system: [{ type: "text", text: P }],
    messages: [{ role: "user", content: "OpenClaw" }],
    tools: [{ name: "x", description: "OpenClaw", input_schema: schema }],
  },
  gemini: {
    systemInstruction: { parts: [{ text: P }] },
    contents: [{ role: "user", parts: [{ text: "OpenClaw" }] }],
    tools: gemTools,
  },
  responses: {
    instructions: P,
    input: [{ role: "user", content: "OpenClaw" }],
    tools: [{ type: "function", name: "x", description: "OpenClaw" }],
  },
  antigravity: {
    project: "p",
    request: {
      systemInstruction: { parts: [{ text: P }] },
      contents: [{ role: "user", parts: [{ text: "OpenClaw" }] }],
      tools: gemTools,
    },
  },
  kiro: {
    conversationState: {
      currentMessage: {
        userInputMessage: {
          content: "OpenClaw user",
          userInputMessageContext: {
            tools: [{ toolSpecification: { name: "x", description: "OpenClaw", inputSchema: { json: schema } } }],
          },
        },
      },
    },
  },
};

const toolsOf = (b) =>
  b.tools ?? b.request?.tools ?? b.conversationState?.currentMessage?.userInputMessage?.userInputMessageContext?.tools;

describe("identity sanitizer (#20992)", () => {
  for (const [name, body] of Object.entries(formats)) {
    it(`${name}: cleaned, pure, idempotent, only descriptions change`, () => {
      const before = clone(body);
      const out = sanitizeIdentity(body);
      expect(body).toEqual(before);
      expect(JSON.stringify(out)).not.toBe(JSON.stringify(body));
      expect(sanitizeIdentity(out)).toEqual(out);
      expect(stripDesc(toolsOf(out))).toEqual(stripDesc(toolsOf(body)));
    });
  }

  it("preserves user content, tool names, commands and paths; rewrites system prose", () => {
    const o = sanitizeIdentity(formats.openai);
    expect(o.messages[1].content).toBe("OpenClaw");
    expect(o.tools[0].function.name).toBe("openclaw");
    expect(o.messages[0].content).toContain("`openclaw gateway status`");
    expect(o.messages[0].content).toContain("/home/m/.openclaw/a");
    expect(o.messages[0].content).not.toMatch(/OpenClaw|DurinDoor/);
    expect(sanitizeIdentity(formats.kiro).conversationState.currentMessage.userInputMessage.content).toBe(
      "OpenClaw user"
    );
  });

  it("is off unless DURINDOOR_SANITIZE_IDENTITY is truthy", () => {
    for (const v of [undefined, "", "0", "false"]) {
      expect(isIdentitySanitizerEnabled({ DURINDOOR_SANITIZE_IDENTITY: v })).toBe(false);
      expect(sanitizeWith(formats.openai, { DURINDOOR_SANITIZE_IDENTITY: v })).toBe(formats.openai);
    }
    for (const v of ["1", "true", "ON", " yes "]) {
      expect(isIdentitySanitizerEnabled({ DURINDOOR_SANITIZE_IDENTITY: v })).toBe(true);
    }
  });

  it("returns foreign payloads unchanged", () => {
    for (const x of [null, undefined, 5, "x", [], {}, { messages: "no" }, { tools: [null, 1] }]) {
      expect(sanitizeIdentity(x)).toBe(x);
    }
    expect(sanitizeText("OpenClaw OpenClaw").length).toBeGreaterThan(0);
  });

  it("keeps code spans, lookalike hosts and schema instance values", () => {
    const t = sanitizeText(
      "OpenClaw docs https://openclaw.ai/a and https://openclaw.ai.evil.test/x and https://evil.test/?u=docs.openclaw.ai ok `run OpenClaw now` end"
    );
    expect(t).toContain("`run OpenClaw now`");
    expect(t).not.toContain("https://openclaw.ai/a");
    expect(t).toContain("https://openclaw.ai.evil.test/x");
    expect(t).toContain("https://evil.test/?u=docs.openclaw.ai");
    const tool = {
      name: "x",
      description: "OpenClaw tool",
      input_schema: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["OpenClaw"], default: "OpenClaw", description: "OpenClaw" },
          description: { type: "string", description: "OpenClaw field" },
          cfg: { type: "object", enum: [{ description: "OpenClaw" }], default: { description: "OpenClaw" } },
        },
      },
    };
    const out = sanitizeIdentity({ tools: [tool] });
    const p = out.tools[0].input_schema.properties;
    expect(out.tools[0].description).toBe("the platform tool");
    expect(p.mode.enum).toEqual(["OpenClaw"]);
    expect(p.mode.default).toBe("OpenClaw");
    expect(p.mode.description).toBe("the platform");
    expect(p.description.description).toBe("the platform field");
    expect(p.cfg.enum).toEqual([{ description: "OpenClaw" }]);
    expect(p.cfg.default).toEqual({ description: "OpenClaw" });
  });

  it("is wired into the chatCore dispatch path", () => {
    const src = readFileSync(new URL("../../open-sse/handlers/chatCore.js", import.meta.url), "utf8");
    expect(src).toContain('from "../services/identitySanitizer.js"');
    expect(src).toMatch(/sanitizeIdentity\(translatedBody\)/);
  });
});
