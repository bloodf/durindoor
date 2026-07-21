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

  it("uses the server runtime port while keeping the Local row local", () => {
    expect(getLocalEndpointUrl(11434)).toBe("http://localhost:11434/v1");
    expect(getLocalEndpointUrl()).toBe("http://localhost:20128/v1");
  });
});
