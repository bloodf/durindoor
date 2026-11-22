import { describe, expect, it } from "vitest";
import {
  isValidModel,
  getModelUpstreamId,
} from "../../open-sse/config/providerModels.js";

// Upstream 9router #2605 (issue #803): Antigravity/MITM IDE sends the canonical
// Google id `gemini-3.1-pro-preview`; it must resolve for `ag` and route to the
// accepted `gemini-pro-agent` upstream id.
describe("antigravity gemini 3.1 pro canonical ids (upstream #2605)", () => {
  for (const id of ["gemini-3.1-pro-preview", "gemini-3.1-pro"]) {
    it(`${id} is valid for ag and maps upstream to gemini-pro-agent`, () => {
      expect(isValidModel("ag", id)).toBe(true);
      expect(getModelUpstreamId("ag", id)).toBe("gemini-pro-agent");
    });
  }
});
