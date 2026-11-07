import { describe, expect, it, vi } from "vitest";
import { comboPolicyRejection, handleFusionChat, LOCAL_POLICY_REJECTION } from "../../open-sse/services/combo.js";

const log = { info() {}, warn() {}, debug() {} };
const body = { stream: true, messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AA==" } }] }] };
const capabilitiesMap = new Map(["p/a", "p/b", "p/judge"].map((model) => [model, { vision: true }]));
const answer = () => Response.json({ choices: [{ message: { content: "panel answer" } }] });
const run = (handleSingleModel, extra = {}) => handleFusionChat({ body, models: ["p/a", "p/b"], handleSingleModel, log, capabilitiesMap, ...extra });

describe("fusion media policy boundaries", () => {
  it("returns a trusted denial only when every panel denies locally", async () => {
    const dispatch = vi.fn(async () => comboPolicyRejection());
    const response = await run(dispatch);
    expect(response.status).toBe(403);
    expect(response[LOCAL_POLICY_REJECTION]).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it.each([403, 429, 499, 503])("does not classify an unmarked %s as unanimous local denial", async (status) => {
    const dispatch = vi.fn(async (_body, model) => model === "p/a" ? comboPolicyRejection() : new Response(null, { status }));
    const response = await run(dispatch);
    expect(response.status).toBe(503);
    expect(response[LOCAL_POLICY_REJECTION]).toBeUndefined();
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it("does not turn a timed-out, aborted panel into a policy denial", async () => {
    let aborted = false;
    const dispatch = vi.fn(async (_body, model, _panel, signal) => {
      if (model === "p/a") return comboPolicyRejection();
      return new Promise((resolve) => signal.addEventListener("abort", () => {
        aborted = true;
        resolve(new Response(null, { status: 499 }));
      }, { once: true }));
    });
    const response = await run(dispatch, { tuning: { panelHardTimeoutMs: 10, panelCancelDrainTimeoutMs: 1000 } });
    expect(aborted).toBe(true);
    expect(response.status).toBe(503);
    expect(response[LOCAL_POLICY_REJECTION]).toBeUndefined();
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it("passes a judge denial through without replaying a panel", async () => {
    const dispatch = vi.fn(async (_body, model) => model === "p/judge" ? comboPolicyRejection() : answer());
    const response = await run(dispatch, { judgeModel: "p/judge" });
    expect(response.status).toBe(403);
    expect(response[LOCAL_POLICY_REJECTION]).toBe(true);
    expect(dispatch.mock.calls.map((call) => call[1])).toEqual(["p/a", "p/b", "p/judge"]);
  });

  it("returns the judge stream unchanged after non-streaming panel calls", async () => {
    const stream = new Response("data: judge\n\n", { headers: { "content-type": "text/event-stream" } });
    const dispatch = vi.fn(async (_body, model) => model === "p/judge" ? stream : answer());
    const response = await run(dispatch, { judgeModel: "p/judge" });
    expect(response).toBe(stream);
    expect(dispatch.mock.calls.map(([request]) => request.stream)).toEqual([false, false, true]);
    expect(await response.text()).toBe("data: judge\n\n");
  });
});
