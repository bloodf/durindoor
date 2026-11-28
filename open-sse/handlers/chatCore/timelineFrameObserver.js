import { createSseFrameDispatcher } from "../../utils/sseFrames.js";
import { createClientFrameFramer } from "./proxyTimelineFrame.js";

/** Share the output stage's observations, retaining the legacy line/NDJSON view. */
export function createTimelineFrameObserver({ format, onFrame }) {
  const framer = format === "sse" ? null : createClientFrameFramer({ format, onFrame });
  const dispatcher = createSseFrameDispatcher();
  let trailingWire = "";
  const emit = (wire) => { if (wire) onFrame(wire.replace(/\r\n/g, "\n").replace(/\r$/, "")); };
  const consume = (batch) => {
    if (framer) {
      if (batch.text) framer.push(batch.text);
    } else {
      for (const frame of batch.frames) {
        if (frame.wire === frame.raw) trailingWire += frame.wire;
        else {
          emit(trailingWire + frame.raw);
          trailingWire = "";
        }
      }
    }
  };
  return {
    push(bytes, batch) { consume(batch ?? dispatcher.push(bytes)); },
    flush(batch) {
      consume(batch ?? dispatcher.flush());
      if (framer) framer.flush();
      else {
        emit(trailingWire);
        trailingWire = "";
      }
    },
  };
}
