import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AWS_REGION_PATTERN, assertValidAwsRegion } from "../../src/lib/oauth/constants/oauth.js";
import * as gateway from "../../open-sse/config/awsRegion.js";
import { resolveKiroControlPlaneHost } from "../../open-sse/config/kiroConstants.js";

describe("gateway AWS region validation", () => {
  it("preserves OAuth exports and accepted region syntax", () => {
    expect(AWS_REGION_PATTERN).toBe(gateway.AWS_REGION_PATTERN);
    expect(assertValidAwsRegion).toBe(gateway.assertValidAwsRegion);
    expect(AWS_REGION_PATTERN.source).toBe("^[a-z]{2}-[a-z]+-\\d{1,2}$");
    for (const region of ["us-east-1", "eu-central-12", "zz-unknown-0"]) {
      expect(assertValidAwsRegion(region)).toBe(region);
    }
    for (const region of ["", "US-east-1", "us-east-123", "us-east-1.evil", " us-east-1", null, undefined, 1, new String("us-east-1")]) {
      expect(() => assertValidAwsRegion(region)).toThrow("Invalid region");
    }
  });

  it("keeps Kiro validation free of src/ AWS-region imports", () => {
    const source = readFileSync(new URL("../../open-sse/config/kiroConstants.js", import.meta.url), "utf8");
    expect(source).toMatch(/from ["']\.\/awsRegion\.js["']/);
    expect(source).not.toMatch(/(?:from\s*|import\s*\()["'][^"']*\/src\/[^"']*awsRegion[^"']*["']/);
    expect(source).not.toMatch(/(?:from\s*|import\s*\()["'][^"']*\/oauth\//);
    const gatewaySource = readFileSync(new URL("../../open-sse/config/awsRegion.js", import.meta.url), "utf8");
    expect(gatewaySource).not.toMatch(/(?:from\s*|import\s*\()["'][^"']*\/(?:src\/lib|oauth)\//);
    expect(resolveKiroControlPlaneHost("eu-central-1")).toBe("https://q.eu-central-1.amazonaws.com");
    expect(() => resolveKiroControlPlaneHost("eu-central-1.evil")).toThrow("Invalid Kiro AWS region");
  });
});
