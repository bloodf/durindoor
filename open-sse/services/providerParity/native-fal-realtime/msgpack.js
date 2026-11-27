// A small, bounded MessagePack codec for the fal realtime WebSocket.
//
// The source (OmniRoute c71f0065a7efe9230ec23b96a12253b050c4d7ad,
// open-sse/handlers/fal/realtime.ts) frames every input with
// `encode(input)` and reads every output with `decode(bytes)` from
// `@msgpack/msgpack`. That package is not a dependency here, so this file
// implements the same wire format (https://github.com/msgpack/msgpack/blob/master/spec.md)
// with the same encoder choices as `@msgpack/msgpack` defaults:
//
// - integers use the smallest positive/negative fixint, uint8..64 or int8..64
//   form; other numbers are float64; `undefined` and `null` are nil;
// - strings use fixstr, str8, str16 or str32 (UTF-8);
// - Uint8Array, Buffer and ArrayBuffer are bin8/16/32;
// - arrays and plain objects are array and map families, keys in insertion order.
//
// Fork deviations (bounded, strict decoding of untrusted upstream frames):
// - a frame must be consumed exactly; trailing bytes are an error;
// - nesting deeper than `maxDepth` is an error, and a declared array/map/str/bin
//   length larger than the remaining bytes is refused before allocation;
// - 64-bit integers outside the safe Number range are refused (no silent
//   precision loss); map keys must be strings or numbers; duplicate keys are
//   refused; strings must be valid UTF-8;
// - ext types other than the timestamp (-1, decoded to Date) are refused, and
//   the encoder refuses values that are not JSON-like or binary.

export const FAL_MSGPACK_MAX_DEPTH = 64;

const utf8 = new TextEncoder();
const utf8Strict = new TextDecoder("utf-8", { fatal: true });

class Writer {
  constructor() {
    this.buffer = new Uint8Array(256);
    this.view = new DataView(this.buffer.buffer);
    this.length = 0;
  }
  ensure(extra) {
    if (this.length + extra <= this.buffer.length) return;
    let size = this.buffer.length * 2;
    while (size < this.length + extra) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buffer.subarray(0, this.length));
    this.buffer = next;
    this.view = new DataView(next.buffer);
  }
  u8(value) { this.ensure(1); this.view.setUint8(this.length, value); this.length += 1; }
  u16(value) { this.ensure(2); this.view.setUint16(this.length, value); this.length += 2; }
  u32(value) { this.ensure(4); this.view.setUint32(this.length, value); this.length += 4; }
  i8(value) { this.ensure(1); this.view.setInt8(this.length, value); this.length += 1; }
  i16(value) { this.ensure(2); this.view.setInt16(this.length, value); this.length += 2; }
  i32(value) { this.ensure(4); this.view.setInt32(this.length, value); this.length += 4; }
  u64(value) { this.ensure(8); this.view.setBigUint64(this.length, BigInt(value)); this.length += 8; }
  i64(value) { this.ensure(8); this.view.setBigInt64(this.length, BigInt(value)); this.length += 8; }
  f64(value) { this.ensure(8); this.view.setFloat64(this.length, value); this.length += 8; }
  bytes(value) { this.ensure(value.length); this.buffer.set(value, this.length); this.length += value.length; }
}

const codecError = (message) => Object.assign(new TypeError(message), { code: "FAL_MSGPACK" });

function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function writeLength(writer, length, [fix, fixMax], [c8, c16, c32]) {
  if (fix !== null && length <= fixMax) writer.u8(fix | length);
  else if (c8 !== null && length < 0x100) { writer.u8(c8); writer.u8(length); }
  else if (length < 0x10000) { writer.u8(c16); writer.u16(length); }
  else if (length <= 0xffffffff) { writer.u8(c32); writer.u32(length); }
  else throw codecError("MessagePack value too large");
}

function encodeNumber(writer, value) {
  if (!Number.isSafeInteger(value)) {
    writer.u8(0xcb);
    writer.f64(value);
  } else if (value >= 0) {
    if (value < 0x80) writer.u8(value);
    else if (value < 0x100) { writer.u8(0xcc); writer.u8(value); }
    else if (value < 0x10000) { writer.u8(0xcd); writer.u16(value); }
    else if (value < 0x100000000) { writer.u8(0xce); writer.u32(value); }
    else { writer.u8(0xcf); writer.u64(value); }
  } else if (value >= -0x20) writer.u8(0xe0 | (value + 0x20));
  else if (value >= -0x80) { writer.u8(0xd0); writer.i8(value); }
  else if (value >= -0x8000) { writer.u8(0xd1); writer.i16(value); }
  else if (value >= -0x80000000) { writer.u8(0xd2); writer.i32(value); }
  else { writer.u8(0xd3); writer.i64(value); }
}

function encodeValue(writer, value, depth, maxDepth) {
  if (depth > maxDepth) throw codecError("MessagePack value nests too deeply");
  if (value === null || value === undefined) return writer.u8(0xc0);
  if (value === false) return writer.u8(0xc2);
  if (value === true) return writer.u8(0xc3);
  if (typeof value === "number") return encodeNumber(writer, value);
  if (typeof value === "string") {
    const bytes = utf8.encode(value);
    writeLength(writer, bytes.length, [0xa0, 31], [0xd9, 0xda, 0xdb]);
    return writer.bytes(bytes);
  }
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    if (!(value instanceof ArrayBuffer) && !(value instanceof Uint8Array)) throw codecError("Only byte arrays can be encoded as MessagePack bin");
    const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : value;
    writeLength(writer, bytes.length, [null, 0], [0xc4, 0xc5, 0xc6]);
    return writer.bytes(bytes);
  }
  if (Array.isArray(value)) {
    writeLength(writer, value.length, [0x90, 15], [null, 0xdc, 0xdd]);
    for (const item of value) encodeValue(writer, item, depth + 1, maxDepth);
    return;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    writeLength(writer, keys.length, [0x80, 15], [null, 0xde, 0xdf]);
    for (const key of keys) {
      encodeValue(writer, key, depth + 1, maxDepth);
      encodeValue(writer, value[key], depth + 1, maxDepth);
    }
    return;
  }
  throw codecError(`Cannot encode ${typeof value} as MessagePack`);
}

/** One MessagePack frame for a JSON-like value (binary allowed). */
export function encodeMsgpack(value, { maxDepth = FAL_MSGPACK_MAX_DEPTH } = {}) {
  const writer = new Writer();
  encodeValue(writer, value, 0, maxDepth);
  return writer.buffer.slice(0, writer.length);
}

class Reader {
  constructor(bytes, maxDepth) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.offset = 0;
    this.maxDepth = maxDepth;
  }
  need(count) {
    if (count > this.bytes.length - this.offset) throw codecError("Truncated MessagePack frame");
  }
  u8() { this.need(1); return this.view.getUint8(this.offset++); }
  u16() { this.need(2); const v = this.view.getUint16(this.offset); this.offset += 2; return v; }
  u32() { this.need(4); const v = this.view.getUint32(this.offset); this.offset += 4; return v; }
  i8() { this.need(1); return this.view.getInt8(this.offset++); }
  i16() { this.need(2); const v = this.view.getInt16(this.offset); this.offset += 2; return v; }
  i32() { this.need(4); const v = this.view.getInt32(this.offset); this.offset += 4; return v; }
  f32() { this.need(4); const v = this.view.getFloat32(this.offset); this.offset += 4; return v; }
  f64() { this.need(8); const v = this.view.getFloat64(this.offset); this.offset += 8; return v; }
  big(signed) {
    this.need(8);
    const v = signed ? this.view.getBigInt64(this.offset) : this.view.getBigUint64(this.offset);
    this.offset += 8;
    if (v > BigInt(Number.MAX_SAFE_INTEGER) || v < BigInt(Number.MIN_SAFE_INTEGER)) throw codecError("MessagePack integer exceeds the safe range");
    return Number(v);
  }
  take(count) {
    this.need(count);
    // A plain Uint8Array copy, even when the frame arrived as a Buffer.
    const out = new Uint8Array(this.bytes.subarray(this.offset, this.offset + count));
    this.offset += count;
    return out;
  }
  str(length) {
    this.need(length);
    const out = utf8Strict.decode(this.bytes.subarray(this.offset, this.offset + length));
    this.offset += length;
    return out;
  }
  array(length, depth) {
    // Every element takes at least one byte, so a larger count is a lie.
    this.need(length);
    const out = new Array(length);
    for (let i = 0; i < length; i++) out[i] = this.value(depth + 1);
    return out;
  }
  map(length, depth) {
    this.need(length * 2);
    const out = {};
    for (let i = 0; i < length; i++) {
      const key = this.value(depth + 1);
      if (typeof key !== "string" && typeof key !== "number") throw codecError("MessagePack map keys must be strings or numbers");
      const name = String(key);
      if (Object.hasOwn(out, name)) throw codecError("Duplicate MessagePack map key");
      Object.defineProperty(out, name, { value: this.value(depth + 1), enumerable: true, writable: true, configurable: true });
    }
    return out;
  }
  ext(length) {
    const type = this.i8();
    const data = this.take(length);
    if (type !== -1) throw codecError("Unsupported MessagePack extension");
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (length === 4) return new Date(view.getUint32(0) * 1000);
    if (length === 8) {
      const high = view.getUint32(0);
      const nanos = high >>> 2;
      const seconds = (high & 0x3) * 0x100000000 + view.getUint32(4);
      return new Date(seconds * 1000 + nanos / 1e6);
    }
    if (length === 12) {
      const seconds = view.getBigInt64(4);
      if (seconds > 8_640_000_000_000n || seconds < -8_640_000_000_000n) throw codecError("MessagePack timestamp out of range");
      return new Date(Number(seconds) * 1000 + view.getUint32(0) / 1e6);
    }
    throw codecError("Invalid MessagePack timestamp");
  }
  value(depth = 0) {
    if (depth > this.maxDepth) throw codecError("MessagePack frame nests too deeply");
    const byte = this.u8();
    if (byte < 0x80) return byte;
    if (byte < 0x90) return this.map(byte & 0x0f, depth);
    if (byte < 0xa0) return this.array(byte & 0x0f, depth);
    if (byte < 0xc0) return this.str(byte & 0x1f);
    if (byte >= 0xe0) return byte - 0x100;
    switch (byte) {
      case 0xc0: return null;
      case 0xc2: return false;
      case 0xc3: return true;
      case 0xc4: return this.take(this.u8());
      case 0xc5: return this.take(this.u16());
      case 0xc6: return this.take(this.u32());
      case 0xc7: return this.ext(this.u8());
      case 0xc8: return this.ext(this.u16());
      case 0xc9: return this.ext(this.u32());
      case 0xca: return this.f32();
      case 0xcb: return this.f64();
      case 0xcc: return this.u8();
      case 0xcd: return this.u16();
      case 0xce: return this.u32();
      case 0xcf: return this.big(false);
      case 0xd0: return this.i8();
      case 0xd1: return this.i16();
      case 0xd2: return this.i32();
      case 0xd3: return this.big(true);
      case 0xd4: return this.ext(1);
      case 0xd5: return this.ext(2);
      case 0xd6: return this.ext(4);
      case 0xd7: return this.ext(8);
      case 0xd8: return this.ext(16);
      case 0xd9: return this.str(this.u8());
      case 0xda: return this.str(this.u16());
      case 0xdb: return this.str(this.u32());
      case 0xdc: return this.array(this.u16(), depth);
      case 0xdd: return this.array(this.u32(), depth);
      case 0xde: return this.map(this.u16(), depth);
      case 0xdf: return this.map(this.u32(), depth);
      default: throw codecError("Invalid MessagePack type byte"); // 0xc1
    }
  }
}

/**
 * Decode exactly one MessagePack value from `bytes`. Binary values come back
 * as Uint8Array copies; timestamps as Date.
 *
 * @throws {TypeError} with `code: "FAL_MSGPACK"` on any malformed frame
 */
export function decodeMsgpack(bytes, { maxDepth = FAL_MSGPACK_MAX_DEPTH } = {}) {
  const input = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  if (!(input instanceof Uint8Array)) throw codecError("MessagePack input must be bytes");
  if (!input.length) throw codecError("Empty MessagePack frame");
  const reader = new Reader(input, maxDepth);
  const value = reader.value();
  if (reader.offset !== input.length) throw codecError("Trailing bytes after MessagePack value");
  return value;
}
