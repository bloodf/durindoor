/**
 * Upstream 9router PR #3276 (cursor AgentService fixes DurinDoor lacked):
 *  - kv blob handshake must hand a stored blob back on get_blob_args
 *    (Claude/GPT-backed runs read their own blobs; an empty reply stalls them).
 *  - Fable has no `-fast` catalog slug, so the agent model id drops it.
 */
import { describe, it, expect } from "vitest";
import { buildKvServerReply, resolveCursorAgentModel } from "../../open-sse/executors/cursor.js";
import { decodeMessage, encodeField } from "../../open-sse/utils/cursorProtobuf.js";

const LEN = 2;
const VARINT = 0;
const bytes = (field, value) => Buffer.from(encodeField(field, LEN, value));

function kvMessage({ id, get, set }) {
  const parts = [];
  if (id) parts.push(Buffer.from(encodeField(1, VARINT, id)));
  if (get) parts.push(bytes(2, bytes(1, get)));
  if (set) parts.push(bytes(3, Buffer.concat([bytes(1, set.id), bytes(2, set.data)])));
  return decodeMessage(Buffer.concat(parts));
}

// Strip the 5-byte Connect frame header, then the AgentClientMessage kv wrapper (field 3).
function kvClientPayload(frame) {
  const outer = decodeMessage(Buffer.from(frame).subarray(5));
  return decodeMessage(outer.get(3)[0].value);
}

describe("buildKvServerReply", () => {
  it("returns a blob stored by set_blob_args on a later get_blob_args", () => {
    const store = new Map();
    const blobId = Buffer.from("blob-1");
    const data = Buffer.from("conversation-state");

    const setAck = buildKvServerReply(kvMessage({ id: 1, set: { id: blobId, data } }), store);
    expect(kvClientPayload(setAck).has(3)).toBe(true);
    expect(store.size).toBe(1);

    const getReply = buildKvServerReply(kvMessage({ id: 2, get: blobId }), store);
    const payload = kvClientPayload(getReply);
    expect(payload.get(1)[0].value).toBe(2);
    const result = decodeMessage(payload.get(2)[0].value);
    expect(Buffer.from(result.get(1)[0].value).toString()).toBe("conversation-state");
  });

  it("acks a get for an unknown blob with an empty result", () => {
    const reply = buildKvServerReply(kvMessage({ id: 3, get: Buffer.from("missing") }), new Map());
    const result = decodeMessage(kvClientPayload(reply).get(2)[0].value);
    expect(result.get(1)?.[0]?.value?.length ?? 0).toBe(0);
  });

  it("returns null when the kv message carries neither get nor set", () => {
    expect(buildKvServerReply(kvMessage({ id: 4 }), new Map())).toBeNull();
  });
});

describe("resolveCursorAgentModel", () => {
  it("drops -fast for Fable only", () => {
    expect(resolveCursorAgentModel("claude-fable-5-thinking-max-fast")).toBe("claude-fable-5-thinking-max");
    expect(resolveCursorAgentModel("claude-opus-5-thinking-max-fast")).toBe("claude-opus-5-thinking-max-fast");
    expect(resolveCursorAgentModel("gpt-5.6-sol-max-fast")).toBe("gpt-5.6-sol-max-fast");
    expect(resolveCursorAgentModel("claude-fable-5-max")).toBe("claude-fable-5-max");
    expect(resolveCursorAgentModel(undefined)).toBeUndefined();
  });
});
