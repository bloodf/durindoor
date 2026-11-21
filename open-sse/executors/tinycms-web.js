import { randomUUID } from "node:crypto";
import { BaseExecutor } from "./base.js";

const CHAT_URL = "https://gov.freegpt.win/api/openai/oneapi/v1/chat/completions";
const CHALLENGE_URL = "https://gov.freegpt.win/api/challenge";

export class TinyCmsExecutor extends BaseExecutor {
  constructor(deps = {}) { super("tinycms-web", { id: "tinycms-web", baseUrl: CHAT_URL }); this.fetcher = deps.fetcher || fetch; }
  async execute(input) {
    const uuid = String(input.credentials?.apiKey || "").trim();
    if (!uuid.startsWith("R")) return { response: new Response(JSON.stringify({ error: { message: "TinyCMS device UUID must start with R", type: "authentication_error" } }), { status: 401, headers: { "content-type": "application/json" } }), url: CHAT_URL, headers: {}, transformedBody: input.body };
    // The pinned TinyCMS client signs a fresh challenge with its WASM signer and PoW.
    // Until that cryptographic client is available, fail closed rather than sending an unsigned request.
    const challenge = await this.fetcher(CHALLENGE_URL, { headers: { uuid, "x-origin": "https://gov.freegpt.win", accept: "application/json" }, signal: input.signal });
    if (!challenge.ok) return { response: new Response(JSON.stringify({ error: { message: `TinyCMS challenge rejected (HTTP ${challenge.status})`, type: "upstream_error" } }), { status: challenge.status }), url: CHALLENGE_URL, headers: {}, transformedBody: input.body };
    const data = await challenge.json();
    return { response: new Response(JSON.stringify({ error: { message: "TinyCMS challenge signer is unavailable", type: "upstream_error", challengeId: data.challengeId, nonce: randomUUID() } }), { status: 503, headers: { "content-type": "application/json" } }), url: CHAT_URL, headers: {}, transformedBody: input.body };
  }
}
export default TinyCmsExecutor;
