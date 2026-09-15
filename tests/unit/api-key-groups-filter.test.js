/**
 * Filter and search semantics for the API Keys list.
 *
 * Which keys a filter hides is a correctness question, not cosmetics: an
 * operator revoking or editing the wrong credential because the list lied is
 * the failure mode these guards exist for.
 */
import { describe, expect, it } from "vitest";
import {
  filterApiKeys,
  groupLabelsForKey,
  matchesGroupFilter,
  matchesSearch,
} from "@/app/(dashboard)/dashboard/keys/apiKeyFilters.js";

const groups = [
  { id: "g-ci", name: "CI" },
  { id: "g-staging", name: "Staging" },
  { id: "g-personal", name: "Personal" },
];

const keys = [
  { id: "k1", name: "ci-deploy", groupIds: ["g-ci"] },
  { id: "k2", name: "staging-runner", groupIds: ["g-staging"] },
  { id: "k3", name: "shared-pipeline", groupIds: ["g-ci", "g-staging"] },
  { id: "k4", name: "laptop", groupIds: [] },
];

describe("group filter", () => {
  it("shows every key when no group is selected", () => {
    expect(filterApiKeys(keys, { selectedGroupIds: [] })).toHaveLength(4);
  });

  it("matches keys in ANY selected group, not only keys in all of them", () => {
    const result = filterApiKeys(keys, { selectedGroupIds: ["g-ci", "g-staging"] });
    // OR semantics: single-group keys survive alongside the overlapping one.
    expect(result.map((key) => key.id)).toEqual(["k1", "k2", "k3"]);
  });

  it("includes a key that belongs to several groups when either is selected", () => {
    expect(matchesGroupFilter(keys[2], ["g-ci"])).toBe(true);
    expect(matchesGroupFilter(keys[2], ["g-staging"])).toBe(true);
  });

  it("excludes ungrouped keys once any group is selected", () => {
    expect(matchesGroupFilter(keys[3], ["g-ci"])).toBe(false);
  });

  it("returns nothing for a group with no members rather than falling back to all", () => {
    // Silently showing every key here would invite acting on the wrong one.
    expect(filterApiKeys(keys, { selectedGroupIds: ["g-personal"] })).toEqual([]);
  });
});

describe("search", () => {
  it("matches a case-insensitive substring of the key name", () => {
    expect(matchesSearch({ name: "ci-deploy" }, "DEPLOY")).toBe(true);
    expect(matchesSearch({ name: "ci-deploy" }, "  deploy  ")).toBe(true);
  });

  it("does not match on group name", () => {
    // "Staging" is a group, not part of this key's name.
    expect(matchesSearch({ name: "ci-deploy", groupIds: ["g-staging"] }, "staging")).toBe(false);
  });

  it("treats an empty or whitespace query as no filter", () => {
    expect(matchesSearch({ name: "laptop" }, "")).toBe(true);
    expect(matchesSearch({ name: "laptop" }, "   ")).toBe(true);
  });

  it("tolerates a key with no name", () => {
    expect(matchesSearch({}, "anything")).toBe(false);
  });
});

describe("combined filter and search", () => {
  it("applies both, not either", () => {
    const result = filterApiKeys(keys, { selectedGroupIds: ["g-ci"], search: "shared" });
    expect(result.map((key) => key.id)).toEqual(["k3"]);
  });

  it("returns nothing when the search excludes every group member", () => {
    expect(filterApiKeys(keys, { selectedGroupIds: ["g-ci"], search: "laptop" })).toEqual([]);
  });
});

describe("group labels", () => {
  it("resolves ids to names in group order", () => {
    expect(groupLabelsForKey(keys[2], groups)).toEqual(["CI", "Staging"]);
  });

  it("drops ids with no matching group instead of rendering a raw uuid", () => {
    expect(groupLabelsForKey({ groupIds: ["g-ci", "g-deleted"] }, groups)).toEqual(["CI"]);
  });

  it("returns an empty list for an ungrouped key", () => {
    expect(groupLabelsForKey(keys[3], groups)).toEqual([]);
  });
});
