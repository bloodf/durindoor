import { describe, expect, it } from "vitest";
import { decodeMessage } from "../../open-sse/utils/cursorProtobuf.js";
import { buildAgentRunFrame } from "../../open-sse/executors/cursor.js";
import { addCursorEffortAliases } from "../../open-sse/services/catalogs/cursorModels.js";

const text = (field) => Buffer.from(field[0].value).toString();

function encoded(model, effort = null, catalogIds = null) {
  const frame = buildAgentRunFrame([{ role: "user", content: "hi" }], model, [], effort, catalogIds);
  const run = decodeMessage(decodeMessage(frame.subarray(5)).get(1)[0].value);
  const requested = decodeMessage(run.get(9)[0].value);
  const parameters = (requested.get(3) || []).map((entry) => {
    const pair = decodeMessage(entry.value);
    return [text(pair.get(1)), text(pair.get(2))];
  });
  return { model: text(requested.get(1)), parameters, legacy: run.has(3) };
}

describe("OmniRoute #20171 (52557cff5451) Cursor speed and reasoning options", () => {
  it.each([
    ["composer-2.5", null, "composer-2.5", ["fast", "false"], false],
    ["composer-2.5", "max", "composer-2.5", ["fast", "false"], false],
    ["composer-2.5-fast", null, "composer-2.5", ["fast", "true"], true],
    ["claude-sonnet-5-5", "medium", "claude-sonnet-5-5", ["reasoning_effort", "medium"], false],
    ["claude-sonnet-5-5-medium", "high", "claude-sonnet-5-5", ["reasoning_effort", "medium"], false],
    ["claude-sonnet-5-5", "high", "claude-sonnet-5-5", ["effort", "high"], true],
    ["claude-haiku-5-5", "medium", "claude-haiku-5-5", ["reasoning_effort", "medium"], false],
    ["claude-haiku-5-5-medium", "high", "claude-haiku-5-5", ["effort", "medium"], true],
    ["deepseek-v41-flash-1017-medium", "high", "deepseek-v41-flash-1017-medium", ["reasoning_effort", "medium"], true],
    ["cu/deepseek-v41-flash-1017-max", "medium", "deepseek-v41-flash-1017-max", ["reasoning_effort", "max"], true],
  ])("encodes %s with client effort %s", (input, effort, model, parameter, legacy) => {
    expect(encoded(input, effort)).toEqual({ model, parameters: [parameter], legacy });
  });

  it("leaves a catalog-listed composer-2.5 on the standard tier", () => {
    expect(encoded("composer-2.5", null, new Set(["composer-2.5"])).parameters).toEqual([["fast", "false"]]);
  });

  it("adds DeepSeek effort variants only when the account lists the base", () => {
    const base = { id: "deepseek-v41-flash-1017", name: "DeepSeek", supportsAgent: true };
    const medium = { ...base, id: `${base.id}-medium`, name: "Discovered Medium" };
    const models = addCursorEffortAliases([base, medium]);
    expect(models.map((model) => model.id)).toEqual([base.id, medium.id, `${base.id}-max`]);
    expect(models[1]).toBe(medium);
    expect(models[2]).toMatchObject({ name: "DeepSeek (max)", supportsAgent: true });
    expect(addCursorEffortAliases([])).toEqual([]);
  });
});
