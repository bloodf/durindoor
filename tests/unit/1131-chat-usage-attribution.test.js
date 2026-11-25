import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ saveRequestUsage: vi.fn().mockResolvedValue(undefined), appendRequestLog: vi.fn(), saveRequestDetail: vi.fn() }));
vi.mock("@/lib/usageDb.js", () => mocks);
const { saveUsageStats } = await import("../../open-sse/handlers/chatCore/requestDetail.js");
it("carries admitted attribution into the terminal usage event", () => {
  saveUsageStats({ provider: "test", model: "test", apiKeyId: "key-a", usageAttribution: { sessionId: "session", projectId: "project" }, tokens: { prompt_tokens: 4, completion_tokens: 2 }, silent: true });
  expect(mocks.saveRequestUsage).toHaveBeenCalledWith(expect.objectContaining({ apiKeyId: "key-a", usageAttribution: { sessionId: "session", projectId: "project" }, tokens: expect.objectContaining({ prompt_tokens: 4, completion_tokens: 2 }) }));
});
