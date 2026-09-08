const ORDER = ["preparing", "loading", "rendering", "playing", "played", "completing", "completed", "afterEach", "finished"];
const RANK = new Map(ORDER.map((phase, index) => [phase, index]));
const REQUIRED = new Set(["loading", "rendering", "completing", "completed", "afterEach", "finished"]);
const FAILURE_PHASES = new Set(["errored", "aborted"]);

export function validateStorybookLifecycle({ storyId, phases, expectedHasPlay }) {
  const errors = [];
  if (typeof storyId !== "string" || !storyId) return ["storyId required"];
  if (typeof expectedHasPlay !== "boolean") return [`${storyId}: expectedHasPlay boolean required`];
  if (!Array.isArray(phases) || !phases.length) return [`${storyId}: phase evidence required`];
  let renderId;
  let lastRank = -1;
  const counts = new Map();
  let playing = 0;
  let played = false;
  let finished = false;
  for (const [index, phase] of phases.entries()) {
    if (!phase || phase.storyId !== storyId) { errors.push(`${storyId}: phase ${index} storyId mismatch`); continue; }
    if (!Number.isFinite(phase.renderId)) { errors.push(`${storyId}: phase ${index} renderId must be a finite number`); continue; }
    if (renderId === undefined) renderId = phase.renderId;
    else if (phase.renderId !== renderId) { errors.push(`${storyId}: phase ${index} renderId mismatch`); continue; }
    const newPhase = phase.newPhase;
    if (typeof newPhase !== "string" || !newPhase) { errors.push(`${storyId}: phase ${index} newPhase required`); continue; }
    if (finished) { errors.push(`${storyId}: phase ${index} occurs after finished`); continue; }
    if (FAILURE_PHASES.has(newPhase)) { errors.push(`${storyId}: phase ${index} ${newPhase}`); continue; }
    const rank = RANK.get(newPhase);
    if (rank === undefined) { errors.push(`${storyId}: phase ${index} unsupported phase ${newPhase}`); continue; }
    if (rank < lastRank) { errors.push(`${storyId}: phase ${index} ${newPhase} out of order`); continue; }
    lastRank = rank;
    counts.set(newPhase, (counts.get(newPhase) ?? 0) + 1);
    if (newPhase === "playing") playing += 1;
    else if (newPhase === "played") { if (playing < 1) errors.push(`${storyId}: phase ${index} played before playing`); played = true; }
    else if (newPhase === "finished") { if (playing > 0 && !played) errors.push(`${storyId}: finished before played`); finished = true; }
  }
  for (const name of REQUIRED) if ((counts.get(name) ?? 0) !== 1) errors.push(`${storyId}: expected exactly one ${name} phase`);
  if ((counts.get("preparing") ?? 0) > 1) errors.push(`${storyId}: duplicate preparing`);
  if ((counts.get("rendering") ?? 0) > 1) errors.push(`${storyId}: duplicate rendering`);
  if (playing !== (expectedHasPlay ? 1 : 0)) errors.push(`${storyId}: expected ${expectedHasPlay ? 1 : 0} playing phase`);
  if ((counts.get("played") ?? 0) !== (expectedHasPlay ? 1 : 0)) errors.push(`${storyId}: played must pair one-to-one with playing`);
  return errors;
}
