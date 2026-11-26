import { isString } from "./typeChecks.js";

// Restrict regions before interpolating them into AWS URLs (GHSA-6mwv-4mrm-5p3m).
export const AWS_REGION_PATTERN = /^[a-z]{2}-[a-z]+-\d{1,2}$/;

export function assertValidAwsRegion(region) {
  if (!isString(region) || !AWS_REGION_PATTERN.test(region)) {
    throw new Error("Invalid region");
  }
  return region;
}
