import { describe, expect, it } from "vitest";
import { cavemanCompress } from "../../open-sse/services/compression/caveman.js";
import { validateCompression } from "../../open-sse/services/compression/validation.js";

// OmniRoute #21156 relaxes the validator because compression respaced code.
// DurinDoor restores preserved blocks after cleanup, so code keeps its spacing
// and the exact check can stay strict.
describe("OmniRoute #21156: code spacing survives compression", () => {
  const snippets = [
    "```php\n<?php require __DIR__ . '/app.php';\n```",
    "`__DIR__ . '/app.php'`",
  ];

  it.each(snippets)("keeps %s byte-identical without a validation fallback", (snippet) => {
    const content = `Please could you just basically explain this very important loader to me:\n${snippet}\nThank you very much indeed.`;
    const result = cavemanCompress(
      { messages: [{ role: "user", content }] },
      { enabled: true, compressRoles: ["user"], minMessageLength: 1, intensity: "ultra" },
    );
    const output = result.body.messages[0].content;

    expect(output).toContain(snippet);
    expect(output.length).toBeLessThan(content.length);
    expect(result.stats.validationErrors).toBeUndefined();
  });

  it("still rejects output that respaced a code block", () => {
    const original = "```py\nif ready:\n    start()\nstop()\n```";
    const respaced = "```py\nif ready:\n    start()\n    stop()\n```";

    expect(validateCompression(original, respaced).valid).toBe(false);
  });
});
