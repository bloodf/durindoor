import { describe, expect, it } from "vitest";
import { settleImages } from "../../.storybook/settle-images.js";

const image = (complete, src = "/providers/openai.svg") => ({ complete, loading: "lazy", getAttribute: () => src });
const rootOf = (list) => ({ querySelectorAll: () => list });

describe("Storybook image settling", () => {
  it("starts lazy images and waits for each to finish", async () => {
    const pending = image(false);
    let settled = false;
    const result = settleImages(rootOf([image(true), pending]), { intervalMs: 1 }).then((count) => { settled = true; return count; });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(pending.loading).toBe("eager");
    expect(settled).toBe(false);
    pending.complete = true;
    await expect(result).resolves.toBe(2);
  });

  it("waits for images mounted after the first pass", async () => {
    const first = image(false);
    const late = image(false);
    const list = [first];
    const result = settleImages(rootOf(list), { intervalMs: 1 });
    list.push(late);
    first.complete = true;
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(late.loading).toBe("eager");
    late.complete = true;
    await expect(result).resolves.toBe(2);
  });

  it("names the images that never finish", async () => {
    await expect(settleImages(rootOf([image(false, "/providers/stuck.png")]), { timeoutMs: 5, intervalMs: 1 }))
      .rejects.toThrow("/providers/stuck.png");
  });
});
