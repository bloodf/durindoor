// OmniRoute #20239: the synthetic Claude OAuth identity belongs to the connection.
import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const identity = (accessToken, connectionId) => {
  const body = { model: "claude-sonnet-4-6", messages: [{ role: "user", content: "hi" }] };
  const out = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, body.model, body, false, { accessToken }, "claude", null, [], connectionId);
  const { device_id: device, account_uuid: account } = JSON.parse(out.metadata.user_id);
  return { device, account };
};
const OLD = "sk-ant-oat01-synthetic-before-refresh";
const NEW = "sk-ant-oat01-synthetic-after-refresh";

describe("port(omniroute): #20239 Claude OAuth identity is keyed by connection", () => {
  it("keeps the device and account ids across a token refresh", () => {
    expect(identity(NEW, "connection-a")).toEqual(identity(OLD, "connection-a"));
  });

  it("gives separate connections separate identities, even with one token", () => {
    const first = identity(OLD, "connection-a");
    const second = identity(OLD, "connection-b");
    expect(second.device).not.toBe(first.device);
    expect(second.account).not.toBe(first.account);
  });

  it("falls back to the token when there is no connection id", () => {
    expect(identity(OLD, null)).toEqual(identity(OLD, null));
    expect(identity(NEW, null)).not.toEqual(identity(OLD, null));
  });
});
