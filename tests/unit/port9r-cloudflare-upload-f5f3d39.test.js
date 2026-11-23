import { describe, expect, it } from "vitest";
import { buildCloudflareWorkerUploadRequest } from "../../src/lib/cloudflare-worker-upload.js";

describe("Cloudflare worker upload", () => {
  it("encodes metadata as a field and the worker as a module", async () => {
    const { body, contentType } = buildCloudflareWorkerUploadRequest("export default {fetch(){return new Response('ok')}}");
    const form = await new Request("https://example.test", { method: "POST", headers: { "Content-Type": contentType }, body }).formData();
    expect(JSON.parse(form.get("metadata"))).toEqual({ main_module: "index.js", bindings: [], compatibility_date: "2024-03-20", observability: { enabled: true } });
    expect(form.get("index.js").type).toBe("application/javascript+module");
    expect(await form.get("index.js").text()).toContain("new Response('ok')");
  });
});
