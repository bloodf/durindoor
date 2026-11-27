// Fixtures are source text held in memory. They are classified, never executed
// or written to the tracked tree.
import { describe, expect, it } from "vitest";
import { isForbiddenUpscaleReference } from "../helpers/upscale-staging-guard.js";

const prefix = "open-sse/services/providerParity/native-syntx-media/";
const privatePaths = [`${prefix}config.js`, `${prefix}index.js`];
const lines = (...parts) => parts.join("\n");

const templateValue = ["const modulePath = `", "// native-image-upscale", "`;"];

const runtimeFixtures = [
  ["template value sliced into an import", lines(...templateValue, "import(modulePath.trim().slice(3));")],
  ["template value assembled into the sibling unit path", lines(...templateValue, 'import("../" + modulePath.trim().slice(3) + "/index.js");')],
  ["template value after a genuine comment header", lines("// Staged adapters.", "", ...templateValue)],
  ["template with an interpolation", lines("const t = `${\"a\"}", "// native-image-upscale", "`;")],
  ["template after an escaped backtick", lines("const t = `\\`", "// native-image-upscale", "`;")],
  ["string continued by a backslash", lines('const s = "\\', '// native-image-upscale";', "import(s.slice(3));")],
  ["template after a quoted block comment closer", lines('const s = "*/"; const t = `', "// native-image-upscale", "`;")],
  ["template after a regex holding a quote", lines('const r = /"/; const t = `', "// native-image-upscale", "`;")],
  ["code after a block comment closes on a lookalike line", lines("/*", '// */ import("../native-image-upscale/index.js");')],
  ...[["CR", "\r"], ["U+2028", " "], ["U+2029", " "]].flatMap(([name, terminator]) => [
    [`code after a comment ended by ${name}`, `// note${terminator}import("../native-image-upscale/index.js");`],
    [`template opened after a comment ended by ${name}`, lines(`// note${terminator}const t = \``, "// native-image-upscale", "`;")],
  ]),
];

const ambiguousFixtures = [
  ["a line comment after code", lines('import x from "./x.js";', "// native-image-upscale ownership note")],
  ["a line comment after a closed template", lines("const t = `a`;", "// native-image-upscale ownership note")],
  ["a lookalike inside a block comment", lines("/*", "// native-image-upscale ownership note", "*/")],
  ["a header note repeated inside a later template", lines("// native-image-upscale ownership note", ...templateValue)],
];

const commentFixtures = [
  ["a comment-only file", "// native-image-upscale ownership note"],
  ["an indented note after blank and comment lines", lines("", "// Staged adapters.", "", "  \t// native-image-upscale ownership note", 'import x from "./x.js";')],
  ["CRLF line endings", '// Staged adapters.\r\n// native-image-upscale ownership note\r\nimport x from "./x.js";\r\n'],
  ["quote and comment openers inside the header", lines("// `unclosed \"quotes' and /* openers", "// native-image-upscale ownership note", "const x = 1;")],
  ["unrelated templates after the header", lines("// native-image-upscale ownership note", "const t = `", "// unrelated", "`;")],
];

describe("upscale staging guard lexical context", () => {
  it("models a runtime value that yields the unit name", () => {
    expect("\n// native-image-upscale\n".trim().slice(3)).toBe("native-image-upscale");
  });

  describe.each(privatePaths)("%s", (path) => {
    it.each(runtimeFixtures)("rejects a %s", (_name, source) => {
      expect(isForbiddenUpscaleReference(path, source)).toBe(true);
    });

    it.each(ambiguousFixtures)("refuses the exemption for %s", (_name, source) => {
      expect(isForbiddenUpscaleReference(path, source)).toBe(true);
    });

    it.each(commentFixtures)("accepts %s", (_name, source) => {
      expect(isForbiddenUpscaleReference(path, source)).toBe(false);
    });
  });
});
