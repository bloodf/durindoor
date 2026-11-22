// @vitest-environment happy-dom
// S20: V5 is the default interface; DURINDOOR_UI_V5=0|false|off is the opt-out.
import { describe, it, expect } from "vitest";
import {
  UI_V5_DEFAULT,
  isUiV5Enabled,
  uiV5RootAttributes,
} from "../../src/shared/ui/v5/production/uiVersion.js";

const resolve = (value) => isUiV5Enabled(value === undefined ? {} : { DURINDOOR_UI_V5: value });

describe("S20 default-on resolution", () => {
  it("defaults to on", () => {
    expect(UI_V5_DEFAULT).toBe(true);
  });

  it("is on when unset", () => {
    expect(resolve(undefined)).toBe(true);
    expect(uiV5RootAttributes({})).toEqual({ "data-ui": "v5" });
  });

  it.each(["garbage", "yes", "2", "v5", ""])("is on for unrecognised value %j", (value) => {
    expect(resolve(value)).toBe(true);
  });

  it.each(["0", "false", "off", "OFF", " False "])("is off for %j", (value) => {
    expect(resolve(value)).toBe(false);
    expect(uiV5RootAttributes({ DURINDOOR_UI_V5: value })).toEqual({});
  });

  it.each(["1", "on", "true", "ON"])("is on for %j", (value) => {
    expect(resolve(value)).toBe(true);
    expect(uiV5RootAttributes({ DURINDOOR_UI_V5: value })).toEqual({ "data-ui": "v5" });
  });
});
