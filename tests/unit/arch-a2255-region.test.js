import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AWS_REGION_PATTERN, assertValidAwsRegion } from "../../src/lib/oauth/constants/oauth.js";
import * as shared from "../../src/shared/utils/awsRegion.js";
import { resolveKiroControlPlaneHost } from "../../open-sse/config/kiroConstants.js";

describe("shared AWS region validation", () => {
  it("preserves OAuth exports and accepted region syntax", () => {
    expect(AWS_REGION_PATTERN).toBe(shared.AWS_REGION_PATTERN);
    expect(assertValidAwsRegion).toBe(shared.assertValidAwsRegion);
    for (const region of ["us-east-1", "eu-central-12", "zz-unknown-0"]) {
      expect(assertValidAwsRegion(region)).toBe(region);
    }
    for (const region of ["", "US-east-1", "us-east-123", "us-east-1.evil", " us-east-1", null, 1, new String("us-east-1")]) {
      expect(() => assertValidAwsRegion(region)).toThrow("Invalid region");
    }
  });

  it("keeps Kiro validation independent of the OAuth layer", () => {
    const source = readFileSync(new URL("../../open-sse/config/kiroConstants.js", import.meta.url), "utf8");
    expect(source).toMatch(/from ["']\.\.\/\.\.\/src\/shared\/utils\/awsRegion\.js["']/);
    expect(source).not.toMatch(/(?:from\s*|import\s*\()["'][^"']*\/oauth\//);
    expect(resolveKiroControlPlaneHost("eu-central-1")).toBe("https://q.eu-central-1.amazonaws.com");
    expect(() => resolveKiroControlPlaneHost("eu-central-1.evil")).toThrow("Invalid Kiro AWS region");
  });
});
