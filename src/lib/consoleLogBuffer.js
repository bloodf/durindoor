import { EventEmitter } from "events";
import { CONSOLE_LOG_CONFIG } from "@/shared/constants/config.js";
import { isString } from "../shared/utils/typeChecks.js";

const consoleLevels = ["log", "info", "warn", "error", "debug"];

if (!global._consoleLogBufferState) {
  global._consoleLogBufferState = {
    logs: [],
    start: 0,
    revision: 0,
    patched: false,
    originals: {},
    emitter: new EventEmitter()
  };
  global._consoleLogBufferState.emitter.setMaxListeners(50);
}

const state = global._consoleLogBufferState;

// Ensure emitter exists (handles hot reload with stale global)
if (!state.emitter) {
  state.emitter = new EventEmitter();
  state.emitter.setMaxListeners(50);
}

if (!state.pendingLines) state.pendingLines = [];
if (!state.flushTimer) state.flushTimer = null;
if (!Number.isSafeInteger(state.revision)) state.revision = 0;
if (!Number.isSafeInteger(state.start)) state.start = 0;

const FLUSH_INTERVAL_MS = 100;
const MAX_BATCH_LINES = 50;

function flushPendingLines() {
  state.flushTimer = null;
  if (!state.pendingLines.length) return;

  const lines = state.pendingLines.splice(0, state.pendingLines.length);
  if (state.emitter.listenerCount("lines")) {
    state.emitter.emit("lines", lines.map(formatLine));
  }
}

function scheduleFlush() {
  if (state.flushTimer) return;
  state.flushTimer = setTimeout(flushPendingLines, FLUSH_INTERVAL_MS);
  state.flushTimer?.unref?.();
}

function formatLine(line) {
  return Array.isArray(line) ? line.map((arg) => arg != null && Object(arg) === arg ? arg.snapshot : formatArg(arg)).join(" ") : line;
}

// Strip ANSI escape codes so terminal colors don't bleed into UI
const ANSI_RE = /\x1b\[[0-9;]*m/g;

function stripAnsi(str) {
  return str.replace(ANSI_RE, "");
}

// Snapshot at capture time with bounded traversal and output, even for hostile values.
function formatArg(arg) {
  try {
    if (isString(arg)) return stripAnsi(arg.slice(0, 16384));
    if (arg instanceof Error) return stripAnsi(String(arg.stack || arg.message).slice(0, 16384));
    const depths = new WeakMap();
    const seen = new WeakSet();
    let remaining = 1000;
    const result = JSON.stringify(arg, function (key, value) {
      if (--remaining < 0) throw new Error("Console snapshot limit exceeded");
      if (isString(value)) return value.slice(0, 16384);
      if (value !== null && Object(value) === value) {
        const depth = key === "" ? 0 : (depths.get(this) ?? 0) + 1;
        if (depth >= 8) return "[Max depth]";
        if (seen.has(value)) return "[Circular]";
        seen.add(value);
        depths.set(value, depth);
      }
      return value;
    });
    return stripAnsi((result === undefined ? String(arg) : result).slice(0, 16384));
  } catch {
    return "[Unformattable]";
  }
}

function appendLine(args) {
  // Mutable values need a capture-time snapshot; primitives can be formatted on read.
  const line = args.map((arg) => arg != null && Object(arg) === arg ? { snapshot: formatArg(arg) } : arg);
  if (state.logs.length < CONSOLE_LOG_CONFIG.maxLines) {
    state.logs.push(line);
  } else {
    state.logs[state.start] = line;
    state.start = (state.start + 1) % CONSOLE_LOG_CONFIG.maxLines;
  }
  state.revision += 1;
  if (!state.emitter.listenerCount("lines")) return;
  state.pendingLines.push(line);
  if (state.pendingLines.length >= MAX_BATCH_LINES) {
    if (state.flushTimer) {
      clearTimeout(state.flushTimer);
      state.flushTimer = null;
    }
    flushPendingLines();
  } else {
    scheduleFlush();
  }
}

export function initConsoleLogCapture() {
  if (state.patched) return;

  for (const level of consoleLevels) {
    state.originals[level] = console[level];
    console[level] = (...args) => {
      appendLine(args);
      state.originals[level](...args);
    };
  }

  state.patched = true;
}

export function getConsoleLogs() {
  return state.logs.slice(state.start).concat(state.logs.slice(0, state.start)).map(formatLine);
}

export function getConsoleLogSnapshot() {
  return { logs: getConsoleLogs(), revision: state.revision };
}

export function clearConsoleLogs() {
  state.logs = [];
  state.start = 0;
  state.pendingLines = [];
  state.revision += 1;
  if (state.flushTimer) {
    clearTimeout(state.flushTimer);
    state.flushTimer = null;
  }
  state.emitter.emit("clear");
}

export function getConsoleEmitter() {
  return state.emitter;
}
