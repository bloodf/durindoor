// Port of upstream 9router #4336: the model catalog advertises the Deepgram
// diarization option the transcription handler already forwards.
import { describe, expect, it } from "vitest";
import { GET } from "../../src/app/api/v1/models/info/route.js";

describe("upstream 9router #4336: Deepgram diarization in the model catalog", () => {
  it.each(["nova-3", "nova-2", "whisper-large", "nova"])("lists diarize_model and language for dg/%s", async (id) => {
    const response = await GET(new Request(`http://localhost/v1/models/info?id=dg/${id}&kind=stt`));

    expect(response.status).toBe(200);
    expect((await response.json()).params).toEqual(["language", "diarize_model"]);
  });
});
