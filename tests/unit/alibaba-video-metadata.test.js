// Public Alibaba video metadata must advertise exactly the framing inputs the
// real request builder accepts. Closed: a throwaway DATA_DIR, no network.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ dir: "", previous: undefined }));

let GET;
let buildAlibabaVideoRequest;
let ALIBABA_VIDEO_MODEL_IDS;
let alibaba;
let PROVIDER_MODELS;

const FRAMING = ["ratio", "aspect_ratio", "size"];
const BASE_PARAMS = ["resolution", "duration", "prompt_extend", "watermark", "seed", "shot_type"];
const IMAGE = "https://example.com/frame.png";
const VIDEO = "https://example.com/clip.mp4";
const isI2V = (id) => /i2v/.test(id);

beforeAll(async () => {
  env.previous = process.env.DATA_DIR;
  env.dir = fs.mkdtempSync(path.join(os.tmpdir(), "alibaba-video-metadata-"));
  process.env.DATA_DIR = env.dir;
  ({ GET } = await import("../../src/app/api/v1/models/info/route.js"));
  ({ buildAlibabaVideoRequest, ALIBABA_VIDEO_MODEL_IDS } = await import("../../open-sse/services/alibabaVideo/request.js"));
  ({ default: alibaba } = await import("../../open-sse/providers/registry/alibaba.js"));
  ({ PROVIDER_MODELS } = await import("../../open-sse/config/providerModels.js"));
});

afterAll(() => {
  if (env.previous === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = env.previous;
  fs.rmSync(env.dir, { recursive: true, force: true });
});

async function info(id) {
  const response = await GET(new Request(`http://local.test/v1/models/info?id=${encodeURIComponent(`ali/${id}`)}`));
  expect(response.status).toBe(200);
  return response.json();
}

// The smallest valid media for a model, found by asking the real builder.
function baseBody(model) {
  for (const media of [{}, { image: IMAGE }, { video: VIDEO }]) {
    const body = { prompt: "a boat at dawn", ...media };
    try {
      buildAlibabaVideoRequest(model, body);
      return body;
    } catch {
      // try the next media shape
    }
  }
  throw new Error(`no base body builds for ${model}`);
}

const FRAMING_INPUTS = {
  ratio: { body: { ratio: "9:16" }, expected: { ratio: "9:16" } },
  aspect_ratio: { body: { aspect_ratio: "1:1" }, expected: { ratio: "1:1" } },
  size: { body: { size: "1920*1080" }, expected: { resolution: "1080P", ratio: "16:9" } },
};

describe("Alibaba video public metadata", () => {
  it("keeps the nine-model video catalog and chat rows intact", () => {
    const videos = alibaba.models.filter((model) => model.kind === "video");
    expect(videos.map((model) => model.id)).toEqual([...ALIBABA_VIDEO_MODEL_IDS]);
    expect(alibaba.models).toContainEqual({ id: "qwen-max", name: "Qwen Max" });
    expect(alibaba.serviceKinds).toEqual(["llm", "video"]);
    const published = (PROVIDER_MODELS.ali || PROVIDER_MODELS.alibaba).filter((model) => model.kind === "video");
    expect(published.map((model) => model.id)).toEqual([...ALIBABA_VIDEO_MODEL_IDS]);
  });

  it("advertises ratio, aspect_ratio and size on non-I2V models, matching the real builder", async () => {
    const models = ALIBABA_VIDEO_MODEL_IDS.filter((id) => !isI2V(id));
    expect(models.length).toBe(6);
    for (const id of models) {
      const row = await info(id);
      expect(row.kind).toBe("video");
      for (const param of [...BASE_PARAMS, ...FRAMING]) expect(row.params, `${id} ${param}`).toContain(param);
      const base = baseBody(id);
      for (const param of FRAMING) {
        const { body, expected } = FRAMING_INPUTS[param];
        const built = buildAlibabaVideoRequest(id, { ...base, ...body });
        expect(built.parameters, `${id} ${param}`).toMatchObject(expected);
      }
    }
  });

  it("advertises none of ratio, aspect_ratio or size on I2V models, which the builder refuses", async () => {
    const models = ALIBABA_VIDEO_MODEL_IDS.filter(isI2V);
    expect(models.length).toBe(3);
    for (const id of models) {
      const row = await info(id);
      expect(row.kind).toBe("video");
      for (const param of BASE_PARAMS) expect(row.params, `${id} ${param}`).toContain(param);
      for (const param of FRAMING) expect(row.params, `${id} ${param}`).not.toContain(param);
      const base = baseBody(id);
      expect(base.image).toBe(IMAGE);
      for (const param of FRAMING) {
        expect(() => buildAlibabaVideoRequest(id, { ...base, ...FRAMING_INPUTS[param].body }), `${id} ${param}`)
          .toThrow(/first frame/);
      }
    }
  });
});
