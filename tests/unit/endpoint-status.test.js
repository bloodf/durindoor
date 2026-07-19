import { describe, expect, it } from "vitest";
import {
  getCompositeEndpointEnabled,
  getLocalEndpointUrl,
} from "@/app/(dashboard)/dashboard/endpoint/endpointConstants.js";

describe("endpoint status presentation", () => {
  it("uses composite running state instead of saved intent", () => {
    expect(getCompositeEndpointEnabled({ settingsEnabled: true, enabled: false })).toBe(false);
    expect(getCompositeEndpointEnabled({ settingsEnabled: true, enabled: true })).toBe(true);
  });

  it("keeps the Local row local when dashboard origin is remote", () => {
    expect(getLocalEndpointUrl()).toBe("http://localhost:20128/v1");
  });
});
