/**
 * #2328 Qoder CN provider registry wiring, superseded by the upstream
 * #4176 port: the #2328 stub (category "free", no working executor) is
 * replaced with a real OAuth/PAT provider matching intl Qoder.
 *
 * Asserts the generated registry resolves the `qoder-cn` entry with the
 * expected endpoint, OAuth fields, category, and executor wiring — i.e.
 * that dropping the file in and regenerating the index actually wires a
 * working provider, not just a registry placeholder.
 */
import { describe, it, expect } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { getExecutor, hasSpecializedExecutor } from "../../open-sse/executors/index.js";
import { QoderExecutor } from "../../open-sse/executors/qoder.js";

describe("qoder-cn registry (#2328, superseded by #4176)", () => {
  const entry = REGISTRY.find((p) => p.id === "qoder-cn");

  it("is present in the generated registry", () => {
    expect(entry, "qoder-cn missing from registry/index.js").toBeTruthy();
  });

  it("targets the Qoder CN gateway over SSE", () => {
    expect(entry.transport.baseUrl).toContain("gateway.qoder.com.cn");
    expect(entry.transport.baseUrl).toContain("sse");
  });

  it("is an oauth-category CN-region provider with oauth+apikey auth", () => {
    expect(entry.category).toBe("oauth");
    expect(entry.authModes).toEqual(["oauth", "apikey"]);
    expect(entry.hasOAuth).toBe(true);
    expect(entry.oauth?.region).toBe("cn");
    expect(entry.oauth?.openApiBaseUrl).toContain("openapi.qoder.com.cn");
    expect(entry.oauth?.loginUrl).toContain("qoder.com.cn/device");
  });

  it("declares the full intl-mirrored model catalog", () => {
    expect(Array.isArray(entry.models)).toBe(true);
    expect(entry.models.length).toBe(16);
    expect(entry.models[0].id).toBeTruthy();
  });

  it("has a QoderExecutor registered under executors/index.js, scoped to the CN region", () => {
    expect(hasSpecializedExecutor("qoder-cn")).toBe(true);
    const executor = getExecutor("qoder-cn");
    expect(executor).toBeInstanceOf(QoderExecutor);
    expect(executor.region).toBe("cn");
    expect(executor.buildUrl()).toContain("gateway.qoder.com.cn");
  });
});
