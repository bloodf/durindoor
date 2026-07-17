import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import {
  KiroExecutor,
  resolveKiroProfileArnAcrossRegions,
} from "../../open-sse/executors/kiro.js";

const US = "us-east-1";
const EU = "eu-central-1";
const EUN = "eu-north-1";
const arn = (r) => `arn:aws:codewhisperer:${r}:966063511238:profile/QN4AXVDKDEX7`;

function responseFor(profiles, ok = true) {
  return { ok, status: ok ? 200 : 403, json: async () => ({ profiles }) };
}

describe("resolveKiroProfileArnAcrossRegions", () => {
  it("returns null with no token", async () => {
    expect(await resolveKiroProfileArnAcrossRegions(null, US, null, null, vi.fn())).toBeNull();
  });

  it("queries the preferred region first and picks the matching-profile ARN", async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url) => {
      calls.push(url);
      if (url.includes(EU)) return responseFor([{ arn: arn(EU) }]);
      return responseFor([{ arn: arn(US) }]);
    });
    const result = await resolveKiroProfileArnAcrossRegions("tok", EU, null, null, fetchImpl);
    expect(result).toBe(arn(EU));
    expect(calls[0]).toBe("https://q.eu-central-1.amazonaws.com");
  });

  it("falls back to the next region when the preferred region yields no profiles", async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url) => {
      calls.push(url);
      // Preferred IDC region eu-north-1 has no Q Developer profile; us-east-1 does.
      if (url.includes(EUN)) return responseFor([]);
      return responseFor([{ arn: arn(US) }]);
    });
    const result = await resolveKiroProfileArnAcrossRegions("tok", EUN, null, null, fetchImpl);
    expect(result).toBe(arn(US));
    expect(calls[0]).toBe("https://q.eu-north-1.amazonaws.com");
  });

  it("uses x-amz-target dispatch shape and forwards the bearer token", async () => {
    const fetchImpl = vi.fn(async () => responseFor([{ arn: arn(US) }]));
    await resolveKiroProfileArnAcrossRegions("bearer-x", US, null, null, fetchImpl);
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/x-amz-json-1.0");
    expect(init.headers["x-amz-target"]).toBe("AmazonCodeWhispererService.ListAvailableProfiles");
    expect(init.headers.Authorization).toBe("Bearer bearer-x");
    expect(JSON.parse(init.body)).toEqual({ maxResults: 10 });
  });

  it("drops an invalid/malicious preferredRegion instead of building an arbitrary host", async () => {
    const fetchImpl = vi.fn(async () => responseFor([{ arn: arn(US) }]));
    const result = await resolveKiroProfileArnAcrossRegions("tok", "../../evil", null, null, fetchImpl);
    expect(result).toBe(arn(US));
    const urls = fetchImpl.mock.calls.map((c) => c[0]);
    expect(urls.every((u) => /^https:\/\/(codewhisperer|q)\.(us-east-1|eu-central-1)\.amazonaws\.com$/.test(u))).toBe(true);
    expect(urls.some((u) => u.includes("evil"))).toBe(false);
  });
});

describe("KiroExecutor routing (getOrderedBaseUrls)", () => {
  const exec = new KiroExecutor({ id: "kiro", baseUrls: ["https://q.us-east-1.amazonaws.com"] });

  it("IDC eu-north-1 + profile eu-central-1 routes q.eu-central-1, profile ARN preserved", () => {
    const creds = { providerSpecificData: { region: EUN, authMethod: "idc", profileArn: arn(EU) } };
    const urls = exec.getOrderedBaseUrls(creds);
    expect(urls[0]).toBe("https://q.eu-central-1.amazonaws.com/generateAssistantResponse");
    expect(urls.every((u) => u.includes(EU) || !u.includes("amazonaws.com"))).toBe(true);
    expect(creds.providerSpecificData.profileArn).toBe(arn(EU));
  });

  it("api_key us-east-1 keeps amazonaws-first order", () => {
    const creds = { providerSpecificData: { region: US, authMethod: "api_key", profileArn: arn(US) } };
    const urls = exec.getOrderedBaseUrls(creds);
    expect(urls.some((u) => u.includes("amazonaws.com"))).toBe(true);
  });
});

describe("KiroExecutor.ensureKiroProfileArn", () => {
  beforeEach(() => {
    proxyAwareFetch.mockReset();
  });

  it("resolves a missing profileArn and stamps both body and credentials", async () => {
    proxyAwareFetch.mockResolvedValue(responseFor([{ arn: arn(EU) }]));
    const exec = new KiroExecutor();
    const body = {};
    const credentials = {
      accessToken: `tok-${Date.now()}-${Math.random()}`,
      providerSpecificData: { region: EUN, authMethod: "idc" },
    };
    await exec.ensureKiroProfileArn({ body, credentials });
    expect(body.profileArn).toBe(arn(EU));
    expect(credentials.providerSpecificData.profileArn).toBe(arn(EU));
    expect(proxyAwareFetch).toHaveBeenCalled();
  });

  it("skips resolution for api_key auth (must use its own account ARN)", async () => {
    const exec = new KiroExecutor();
    const body = {};
    const credentials = {
      accessToken: `tok-${Date.now()}-${Math.random()}`,
      providerSpecificData: { region: US, authMethod: "api_key" },
    };
    await exec.ensureKiroProfileArn({ body, credentials });
    expect(body.profileArn).toBeUndefined();
    expect(credentials.providerSpecificData.profileArn).toBeUndefined();
    expect(proxyAwareFetch).not.toHaveBeenCalled();
  });
});
