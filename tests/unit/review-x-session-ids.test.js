import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { resolveClientSessionId } from "../../open-sse/utils/sessionManager.js";

describe("client session ID encoding", () => {
  it("separates a Unicode ID from a literal matching its encoded form", () => {
    const resolve = (session_id) => resolveClientSessionId({ body: { session_id } });
    const encoded = resolve("会话");

    expect(encoded).toMatch(/^sid_[0-9a-f]{32}$/);
    expect(resolve("会话")).toBe(encoded);
    expect(resolve(encoded)).not.toBe(encoded);
    expect(resolve(encoded)).toBe(resolve(encoded));
    expect(resolve("plain-session_123")).toBe("plain-session_123");
  });

  it("does not let any literal encoded-looking ID reach a Unicode ID's session", () => {
    const resolve = (session_id) => resolveClientSessionId({ body: { session_id } });
    const digest = createHash("sha256").update("会话", "utf16le").digest("hex").slice(0, 32);

    expect(resolve(`sid_${digest}`)).not.toBe(resolve("会话"));
  });
});
