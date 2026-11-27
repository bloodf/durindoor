import { describe, it, expect } from "vitest";
import { parseDataUri } from "../../open-sse/translator/concerns/image.js";
import { convertOpenAIContentToParts } from "../../open-sse/translator/formats/gemini.js";

describe("9router #1 - data URLs with media-type parameters", () => {
  it("parses base64 data URLs that carry parameters before ;base64", () => {
    expect(parseDataUri("data:image/png;charset=utf-8;base64,AAAA")).toEqual({ mimeType: "image/png", base64: "AAAA" });
    expect(parseDataUri("data:image/jpeg;name=a.jpg;BASE64,BBBB")).toEqual({ mimeType: "image/jpeg", base64: "BBBB" });
  });

  it("still rejects non-base64 and malformed data URLs", () => {
    expect(parseDataUri("data:image/png,AAAA")).toBeNull();
    expect(parseDataUri("data:image/png;charset=utf-8,AAAA")).toBeNull();
    expect(parseDataUri("data:image/png;base64,")).toBeNull();
    expect(parseDataUri("data:;base64,AAAA")).toBeNull();
  });

  it("keeps parameterized `image` blocks when converting to Gemini parts", () => {
    const parts = convertOpenAIContentToParts([{ type: "image", image: "data:image/webp;charset=binary;base64,CCCC" }]);
    expect(parts).toEqual([{ inlineData: { mimeType: "image/webp", data: "CCCC" } }]);
  });
});
