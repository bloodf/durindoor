# DurinDoor v5 upstream freeze

This census records the finite upstream intake boundary owned by the repository maintainer. The owner freeze was defined at **2026-11-27T23:49:25.752045+00:00**. It replaces rolling upstream intake for v5. These records preserve the root metadata and captured paginated PR snapshots byte-for-byte; the hashes below are SHA-256 of those exact source files.

## Frozen sources and evidence

| Source | Frozen default head | Tracker record | Open PR snapshot |
| --- | --- | --- | --- |
| [decolua/9router](https://github.com/decolua/9router), `master` | `5ae63d22847e07042e235b40e1d926b65e509013` | [#1072](https://github.com/bloodf/durindoor/issues/1072#issuecomment-7230442320) | [9router snapshot](v5-freeze-9router-open-prs.json), 1,375 rows, SHA-256 `b69a288048a9467df5df26eb80b197fac0d4fc1e9fec3d046b68a2986315027a` |
| [cheaper-inference/OmniRoute](https://github.com/cheaper-inference/OmniRoute), `release/v3.8.55` | `3e23a8afe026a4980926c2fcab5b1fcfabb995c4` | [#1073](https://github.com/bloodf/durindoor/issues/1073#issuecomment-7230442456) | [OmniRoute snapshot](v5-freeze-omniroute-open-prs.json), 628 rows, SHA-256 `1fd027b16e1a944d0e3d7a3ab90f608e0ec4671fa07d0fb44bce2e51eb559734` |

The exact root metadata is [v5-upstream-freeze.json](v5-upstream-freeze.json), SHA-256 `ce6b01848234837de06ab0de4ab24c3c8b573c36147634718b4625d73584fad2`. Metadata observed the frozen default heads at `2026-11-27T23:49:24.688458+00:00` (9router) and `2026-11-27T23:49:25.752013+00:00` (OmniRoute). The paginated open-PR snapshots were captured later: 9router from `2026-11-27T23:50:47.897657+00:00` through `2026-11-27T23:51:08.152619+00:00`; OmniRoute from `2026-11-27T23:51:08.160220+00:00` through `2026-11-27T23:51:19.412710+00:00`. Snapshot intervals describe collection time, not a later freeze. Each snapshot records its frozen base SHA and pagination limits.

## Boundary and handling

The immutable default-head freeze and the paginated open-PR capture interval are distinct evidence. Only pre-freeze source commits and PRs are in scope. Exclude PRs created after the owner freeze. If a captured PR was updated after the freeze, its captured head is not proof of its freeze-time revision: verify the historical head before investigating or doing work. In particular, OmniRoute PR [#21474](https://github.com/cheaper-inference/OmniRoute/pull/21474) has a captured `updatedAt` after the freeze and requires historical-head proof. Never silently adopt a latest head or newer upstream commit.

The census is a finite inventory, not a parity-complete claim. Every pre-freeze commit and PR needs an evidence-backed port or disposition before upstream intake is considered complete; do not infer per-item “not applicable” from absence in a prior ledger. Reuse existing ledger references and ownership records where they apply, then record evidence for each item against the frozen source revision. The root sync lane owns 9router parity; the review lane owns OmniRoute parity. Preserve existing ownership, registration, and train boundaries.

Until v5 ships, create no new upstream issues, units, or work from these inventories. After v5 ships, later upstream intake is limited to one post-v5 backlog list on tracker [#1072](https://github.com/bloodf/durindoor/issues/1072) and [#1073](https://github.com/bloodf/durindoor/issues/1073); do not resume rolling searches. Capacity then returns to the remaining v5 issues. Existing frozen source pins and records remain evidence.

## Existing ledger references

This record reuses the existing [9router #1072 intake](../upstream-port-1072.md), [9router provider intake](../upstream-1072-provider-intake.md), [OmniRoute #1073 working notes](../omniroute-open-prs-1073.md), and historical reports in this directory. Those references remain prior evidence; they do not by themselves establish complete disposition of this freeze census.
