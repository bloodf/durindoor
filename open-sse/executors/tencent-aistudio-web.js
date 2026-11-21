import { BaseExecutor } from "./base.js";
import { stripCookieInputPrefix } from "@/lib/providers/webCookieAuth.js";

const ROOT = "https://aistudio.tencent.ai";
const MODEL_MAP = { "hy3-g": "HunyuanDefault", "hunyuan-default": "HunyuanDefault", "hunyuan-3d": "Hunyuan3D" };

export class TencentAIStudioWebExecutor extends BaseExecutor {
  constructor() { super("tencent-aistudio-web", { id: "tencent-aistudio-web", baseUrl: ROOT }); }
  buildUrl(model) { return `${ROOT}/api/chat/${MODEL_MAP[model] || "HunyuanDefault"}`; }
  async execute(input) {
    const cookie = stripCookieInputPrefix(input.credentials?.apiKey || "");
    const url = this.buildUrl(input.model);
    if (!cookie) return { response: new Response(JSON.stringify({ error: { message: "Tencent AI Studio cookie is required", type: "authentication_error" } }), { status: 401, headers: { "content-type": "application/json" } }), url, headers: {}, transformedBody: input.body };
    const headers = { "content-type": "application/json", accept: input.body?.stream ? "text/event-stream" : "application/json", cookie, origin: ROOT, referer: `${ROOT}/` };
    const response = await fetch(url, { method: "POST", headers, body: JSON.stringify({ model: MODEL_MAP[input.model] || "HunyuanDefault", messages: input.body?.messages || [] }), signal: input.signal });
    return { response, url, headers, transformedBody: input.body };
  }
}
export default TencentAIStudioWebExecutor;
