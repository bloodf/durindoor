import { describe, expect, it } from "vitest";
import { validateStorybookLifecycle } from "../e2e/storybook-lifecycle.mjs";

const id = "story--case";
const RID = 1788668601581;
const phase = (newPhase, overrides = {}) => ({ storyId: id, renderId: RID, newPhase, ...overrides });
const seq = (names) => names.map((n) => phase(n));
const stable = ["loading", "rendering", "playing", "played", "completing", "completed", "afterEach", "finished"];
const noPlay = ["loading", "rendering", "completing", "completed", "afterEach", "finished"];
const run = (phases, expectedHasPlay) => validateStorybookLifecycle({ storyId: id, phases, expectedHasPlay });

describe("validateStorybookLifecycle", () => {
  it("accepts stable play and no-play captured sequences", () => {
    expect(run(seq(stable), true)).toEqual([]);
    expect(run(seq(noPlay), false)).toEqual([]);
    expect(run(seq(["preparing", ...stable]), true)).toEqual([]);
  });
  it("rejects full-history reload after play despite successful finish", () => {
    expect(run(seq(["preparing", "loading", "rendering", "playing", "loading", "rendering", "completing", "completed", "afterEach", "finished"]), true)).not.toEqual([]);
  });
  it("rejects differing renderId and storyId identities", () => {
    const diffRender = seq(stable);
    diffRender[3] = phase("played", { renderId: 2 });
    expect(run(diffRender, true)).not.toEqual([]);
    const diffStory = seq(stable);
    diffStory[3] = phase("played", { storyId: "other--story" });
    expect(run(diffStory, true)).not.toEqual([]);
  });
  it("rejects duplicate playing, errored status, finish before played, and late rendering after finished", () => {
    expect(run(seq(["loading", "rendering", "playing", "playing", "played", "completing", "completed", "afterEach", "finished"]), true)).not.toEqual([]);
    expect(run(seq(["loading", "rendering", "errored", "completing", "completed", "afterEach", "finished"]), true)).not.toEqual([]);
    expect(run(seq(["loading", "rendering", "playing", "finished"]), true)).not.toEqual([]);
    expect(run(seq(["loading", "rendering", "completing", "completed", "afterEach", "finished", "rendering"]), false)).not.toEqual([]);
  });
  it("rejects string renderId, missing terminal phases, and dropped play when hasPlay expected", () => {
    expect(run(seq(stable).map((p, i) => i === 0 ? { ...p, renderId: "abc" } : p), true)).not.toEqual([]);
    expect(run(seq(stable).slice(0, 5), true)).not.toEqual([]);
    expect(run(seq(noPlay), true)).not.toEqual([]);
  });
  it("rejects no-play story that secretly played", () => {
    expect(run(seq(stable), false)).not.toEqual([]);
  });
});
