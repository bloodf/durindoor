import { describe, it, expect } from "vitest";
import { convertOpenAIContentToParts } from "../../open-sse/translator/formats/gemini.js";

const PDF_DATA = "data:application/pdf;base64,JVBERi0xLjE=";
const PDF_BASE64 = "JVBERi0xLjE=";

describe("gemini file_data PDF preservation", () => {
  it("preserves OpenAI chat file.file_data PDF", () => {
    const parts = convertOpenAIContentToParts([
      { type: "file", file: { filename: "d.pdf", file_data: PDF_DATA } },
    ]);
    const inline = parts.find((p) => p.inlineData);
    expect(inline).toBeTruthy();
    expect(inline.inlineData.mime_type).toBe("application/pdf");
    expect(inline.inlineData.data).toBe(PDF_BASE64);
  });

  it("preserves camelCase file.fileData", () => {
    const parts = convertOpenAIContentToParts([
      { type: "file", file: { filename: "d.pdf", fileData: PDF_DATA } },
    ]);
    const inline = parts.find((p) => p.inlineData);
    expect(inline).toBeTruthy();
    expect(inline.inlineData.mime_type).toBe("application/pdf");
    expect(inline.inlineData.data).toBe(PDF_BASE64);
  });

  it("preserves raw file.data base64 with explicit mime_type", () => {
    const parts = convertOpenAIContentToParts([
      { type: "file", file: { filename: "d.pdf", data: PDF_BASE64, mime_type: "application/pdf" } },
    ]);
    const inline = parts.find((p) => p.inlineData);
    expect(inline).toBeTruthy();
    expect(inline.inlineData.mime_type).toBe("application/pdf");
    expect(inline.inlineData.data).toBe(PDF_BASE64);
  });

  it("preserves document.file_data PDF", () => {
    const parts = convertOpenAIContentToParts([
      { type: "file", document: { filename: "d.pdf", file_data: PDF_DATA } },
    ]);
    const inline = parts.find((p) => p.inlineData);
    expect(inline).toBeTruthy();
    expect(inline.inlineData.mime_type).toBe("application/pdf");
    expect(inline.inlineData.data).toBe(PDF_BASE64);
  });

  it("preserves document.fileData PDF with explicit mimeType", () => {
    const parts = convertOpenAIContentToParts([
      { type: "file", document: { filename: "d.pdf", fileData: PDF_DATA, mimeType: "application/pdf" } },
    ]);
    const inline = parts.find((p) => p.inlineData);
    expect(inline).toBeTruthy();
    expect(inline.inlineData.mime_type).toBe("application/pdf");
    expect(inline.inlineData.data).toBe(PDF_BASE64);
  });

  it("ignores http file_data URIs", () => {
    const parts = convertOpenAIContentToParts([
      { type: "file", file: { filename: "d.pdf", file_data: "https://x/d.pdf" } },
    ]);
    expect(parts.some((p) => p.inlineData)).toBe(false);
  });

  it("preserves non-PDF file.fileData with extracted MIME", () => {
    const pngData = "data:image/png;base64,iVBORw0KGgo=";
    const parts = convertOpenAIContentToParts([
      { type: "file", file: { filename: "i.png", fileData: pngData } },
    ]);
    const inline = parts.find((p) => p.inlineData);
    expect(inline).toBeTruthy();
    expect(inline.inlineData.mime_type).toBe("image/png");
    expect(inline.inlineData.data).toBe("iVBORw0KGgo=");
  });

  it("prefers explicit mime_type over data URI MIME", () => {
    const parts = convertOpenAIContentToParts([
      { type: "file", file: { filename: "d.pdf", file_data: PDF_DATA, mime_type: "application/pdf" } },
    ]);
    const inline = parts.find((p) => p.inlineData);
    expect(inline).toBeTruthy();
    expect(inline.inlineData.mime_type).toBe("application/pdf");
  });
});
