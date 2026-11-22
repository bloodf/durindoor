import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("https", () => ({ default: { get: vi.fn((_url, _options, callback) => {
  const req = new EventEmitter();
  req.destroy = () => {};
  queueMicrotask(() => { const res = new EventEmitter(); callback(res); res.emit("data", '{"version":"99.0.0"}'); res.emit("end"); });
  return req;
}) } }));
import { GET } from "../../src/app/api/version/route.js";
const original = process.env.TRAY_MODE;
afterEach(() => { if (original === undefined) delete process.env.TRAY_MODE; else process.env.TRAY_MODE = original; });
it.each([["1", true], ["0", false]])("reports tray mode %s", async (value, expected) => {
  process.env.TRAY_MODE = value;
  expect((await (await GET()).json()).isTrayMode).toBe(expected);
});
