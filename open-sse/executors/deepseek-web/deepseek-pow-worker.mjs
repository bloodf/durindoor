import { isString } from "../../../src/shared/utils/typeChecks.js";
// Ported from cheaper-inference/OmniRoute (MIT), 4265bb2ad5477450a07d3a43ea33a62c6c874878
// Source: open-sse/lib/deepseek-pow-worker.mjs; see LICENSE.omniroute.
import { parentPort, workerData } from "node:worker_threads";

import { findDeepSeekPowNonce, MAX_DEEPSEEK_POW_DIFFICULTY } from "./deepseek-pow-hash.js";

if (!parentPort) {
  throw new Error("DeepSeek PoW worker requires a parent port");
}

const { challenge, prefix, difficulty } = workerData;
if (
  !isString(challenge) ||
  !isString(prefix) ||
  !Number.isSafeInteger(difficulty) ||
  difficulty < 1 ||
  difficulty > MAX_DEEPSEEK_POW_DIFFICULTY
) {
  throw new Error("DeepSeek PoW worker received invalid input");
}

parentPort.postMessage(findDeepSeekPowNonce(prefix, challenge, difficulty));
