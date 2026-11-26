import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/sse/services/resourceOwnership.js", () => ({ resolveResourceOwner: vi.fn() }));
vi.mock("open-sse/services/localFilesBatches.js", () => ({
  maxBatchBytes: () => Number(process.env.MAX_BATCH_BYTES || 100),
  uploadFile: vi.fn(async ({ purpose }) => ({ purpose })),
  listFiles: vi.fn(),
}));

import { POST } from "../../src/app/api/v1/files/route.js";
import { resolveResourceOwner } from "@/sse/services/resourceOwnership.js";
import { uploadFile } from "open-sse/services/localFilesBatches.js";

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

function formRequest(purpose, content) {
  const form = new FormData();
  form.append("file", new Blob([content]), "test.txt");
  form.append("purpose", purpose);
  return new Request("http://localhost/v1/files", { method: "POST", body: form });
}

describe("file upload admission", () => {
  it("authenticates before reading an oversized request", async () => {
    resolveResourceOwner.mockResolvedValue({ authorized: false });
    const request = new Request("http://localhost/v1/files", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=x", "content-length": "2000000" }, body: "x" });
    expect((await POST(request)).status).toBe(401);
    expect(request.bodyUsed).toBe(false);
  });

  it("rejects declared and streamed oversized requests before multipart parsing", async () => {
    resolveResourceOwner.mockResolvedValue({ authorized: true });
    vi.stubEnv("MAX_BATCH_BYTES", "8");
    const headers = { "content-type": "multipart/form-data; boundary=x" };
    const declared = new Request("http://localhost/v1/files", { method: "POST", headers: { ...headers, "content-length": "1048585" }, body: "x" });
    expect((await POST(declared)).status).toBe(413);
    expect(declared.bodyUsed).toBe(false);
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(1048585)); controller.close(); } });
    const unknown = new Request("http://localhost/v1/files", { method: "POST", headers, body: stream, duplex: "half" });
    expect((await POST(unknown)).status).toBe(413);
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it("returns a malformed body response when the upload stream is interrupted", async () => {
    resolveResourceOwner.mockResolvedValue({ authorized: true });
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("--x\r\n"));
        controller.error(new Error("upload interrupted"));
      },
    });
    const request = new Request("http://localhost/v1/files", {
      method: "POST", headers: { "content-type": "multipart/form-data; boundary=x" }, body: stream, duplex: "half",
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { message: "Invalid multipart body" } });
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it("retains the batch file limit and accepts other purposes", async () => {
    resolveResourceOwner.mockResolvedValue({ authorized: true });
    vi.stubEnv("MAX_BATCH_BYTES", "8");
    expect((await POST(formRequest("batch", "123456789"))).status).toBe(400);
    expect((await POST(formRequest("assistants", "123456789"))).status).toBe(201);
    expect(uploadFile).toHaveBeenCalledWith(expect.objectContaining({ purpose: "assistants" }), expect.anything());
    expect((await POST(formRequest("batch", "12345678"))).status).toBe(201);
  });
});
