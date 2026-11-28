import { isString } from "../../../src/shared/utils/typeChecks.js";
// Adapted from cheaper-inference/OmniRoute (MIT), 4265bb2ad5477450a07d3a43ea33a62c6c874878
// open-sse/lib/deepseek-pow.ts and executors/deepseek-web/pow.ts. See LICENSE.omniroute.
import { Worker } from "node:worker_threads";
import path from "node:path";
import { MAX_DEEPSEEK_POW_DIFFICULTY } from "./deepseek-pow-hash.js";

let active = 0;
const TARGET = "/api/v0/chat/completion";
export const POW_TARGET = TARGET;

/** Workers own only challenge data, never credentials. Slots remain held until termination. */
export async function solveChallenge(challenge, { signal, timeoutMs = 10_000 } = {}) {
  if (signal?.aborted) throw new DOMException("Request aborted", "AbortError");
  const c = { ...challenge };
  if (c?.algorithm !== "DeepSeekHashV1" || !/^[a-f0-9]{64}$/i.test(c?.challenge) ||
      !isString(c?.salt) || !c.salt.length || c.salt.length > 1024 ||
      !isString(c?.signature) || !c.signature.length || c.signature.length > 8192 ||
      !Number.isSafeInteger(c.difficulty) || c.difficulty < 1 || c.difficulty > MAX_DEEPSEEK_POW_DIFFICULTY ||
      !Number.isSafeInteger(c.expire_at) || c.expire_at < 0 || c.target_path !== TARGET ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new Error("Unsupported DeepSeek proof of work");
  }
  if (active >= 2) throw new Error("DeepSeek proof of work capacity reached");
  active++;
  let worker;
  try {
    // The packaging manifest includes the entire open-sse directory. Resolve from the
    // runtime root: bundlers can freeze import.meta.url to a build-machine path.
    worker = new Worker(path.join(process.cwd(), "open-sse/executors/deepseek-web/deepseek-pow-worker.mjs"), {
      workerData: { challenge: c.challenge.toLowerCase(), prefix: `${c.salt}_${c.expire_at}_`, difficulty: c.difficulty },
      env: {}, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 32, maxYoungGenerationSizeMb: 8, stackSizeMb: 2 },
    });
    const answer = await new Promise((resolve, reject) => {
      const failAbort = () => reject(new DOMException("Request aborted", "AbortError"));
      const timer = setTimeout(() => reject(new Error("DeepSeek proof of work deadline exceeded")), timeoutMs);
      signal?.addEventListener("abort", failAbort, { once: true });
      worker.once("message", resolve);
      worker.once("error", reject);
      worker.once("exit", () => reject(new Error("DeepSeek proof of work worker exited")));
      // Register cleanup before yielding, including the abort-registration race.
      worker._deepSeekCleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", failAbort); };
      if (signal?.aborted) failAbort();
    });
    if (!Number.isSafeInteger(answer) || answer < 0 || answer >= c.difficulty) throw new Error("DeepSeek proof of work failed");
    signal?.throwIfAborted();
    return Buffer.from(JSON.stringify({ algorithm: c.algorithm, challenge: c.challenge, salt: c.salt,
      answer, signature: c.signature, target_path: TARGET })).toString("base64");
  } finally {
    worker?._deepSeekCleanup?.();
    if (worker) await worker.terminate();
    active--;
  }
}
