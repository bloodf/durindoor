import { expect, it } from "vitest";
import { CodexExecutor } from "../../open-sse/executors/codex.js";

it("keeps translated instructions in the cacheable prefix while preserving native instructions", () => {
  const executor = new CodexExecutor();
  const input = [{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }];
  const make = (context) => executor.transformRequest("gpt-5.4", { instructions: "Follow these rules", input: structuredClone(input) }, true, {}, context);
  const translated = make({ translatedToCodex: true });
  expect(translated.instructions).toBe("You are a helpful assistant.");
  expect(translated.input[0]).toMatchObject({ role: "developer", content: [{ text: "Follow these rules" }] });
  expect(translated.input[1].role).toBe("user");
  const native = make({});
  expect(native.instructions).toBe("Follow these rules");
  expect(native.input[0].role).toBe("user");
});
