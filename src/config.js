"use strict";

/** Stable library identity in native JSON Lines and JS event payloads. Not configurable. */
const LIB = "js-ak/watchdog";

const DEFAULT_CAPTURE_STACK = Object.freeze({
  mode: "interrupt",
  on: "both",
  maxFrames: 50,
  maxSamples: 8,
});

const DEFAULT_CAPTURE_STACK_PROFILE = Object.freeze({
  mode: "profile",
  on: "both", // ignored by native; kept for a stable normalized shape
  maxFrames: 50,
  maxSamples: 8,
});

const DEFAULTS = Object.freeze({
  freezeThresholdMs: 1000,
  heartbeatMs: 1000,
  logTarget: "stderr",
  logFile: "./watchdog.log",
  // Soft cap for the active log file (one `<logFile>.1` backup). 0 = off.
  logMaxBytes: 10 * 1024 * 1024,
  captureStack: false,
});

const LOG_TARGETS = new Set(["stderr", "file", "both"]);
const CAPTURE_STACK_ON = new Set(["started", "heartbeat", "both"]);

const MIN_MS = 1;
const MAX_MS = 3_600_000; // 1 hour
const MIN_STACK_FRAMES = 1;
const MAX_STACK_FRAMES = 256;
const MIN_STACK_SAMPLES = 1;
const MAX_STACK_SAMPLES = 32;
const MAX_SOURCE_LENGTH = 256;
// 0 disables in-process rotation; otherwise up to 1 GiB.
const MIN_LOG_MAX_BYTES = 0;
const MAX_LOG_MAX_BYTES = 1024 * 1024 * 1024;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertPositiveIntInRange(name, value) {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new TypeError(
      `${name} must be a positive integer, got ${describeValue(value)}`,
    );
  }
  if (value < MIN_MS || value > MAX_MS) {
    throw new RangeError(
      `${name} must be between ${MIN_MS} and ${MAX_MS}, got ${value}`,
    );
  }
}

function describeValue(value) {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return "array";
  }
  return typeof value;
}

function normalizeCaptureStack(value) {
  if (value === false || value === undefined) {
    return false;
  }

  let options = value;
  if (value === true) {
    options = {};
  } else if (!isPlainObject(value)) {
    throw new TypeError(
      `captureStack must be false, true, or a plain object, got ${describeValue(value)}`,
    );
  }

  const mode = options.mode === undefined ? DEFAULT_CAPTURE_STACK.mode : options.mode;
  if (mode !== "interrupt" && mode !== "profile") {
    throw new TypeError(
      `captureStack.mode must be "interrupt" or "profile", got ${describeValue(mode)}`,
    );
  }

  const maxFrames =
    options.maxFrames === undefined
      ? DEFAULT_CAPTURE_STACK.maxFrames
      : options.maxFrames;
  if (typeof maxFrames !== "number" || !Number.isInteger(maxFrames)) {
    throw new TypeError(
      `captureStack.maxFrames must be an integer, got ${describeValue(maxFrames)}`,
    );
  }
  if (maxFrames < MIN_STACK_FRAMES || maxFrames > MAX_STACK_FRAMES) {
    throw new RangeError(
      `captureStack.maxFrames must be between ${MIN_STACK_FRAMES} and ${MAX_STACK_FRAMES}, got ${maxFrames}`,
    );
  }

  const maxSamples =
    options.maxSamples === undefined
      ? DEFAULT_CAPTURE_STACK.maxSamples
      : options.maxSamples;
  if (typeof maxSamples !== "number" || !Number.isInteger(maxSamples)) {
    throw new TypeError(
      `captureStack.maxSamples must be an integer, got ${describeValue(maxSamples)}`,
    );
  }
  if (maxSamples < MIN_STACK_SAMPLES || maxSamples > MAX_STACK_SAMPLES) {
    throw new RangeError(
      `captureStack.maxSamples must be between ${MIN_STACK_SAMPLES} and ${MAX_STACK_SAMPLES}, got ${maxSamples}`,
    );
  }

  if (mode === "profile") {
    return Object.freeze({
      mode,
      on: DEFAULT_CAPTURE_STACK_PROFILE.on,
      maxFrames,
      maxSamples,
    });
  }

  const on = options.on === undefined ? DEFAULT_CAPTURE_STACK.on : options.on;
  if (!CAPTURE_STACK_ON.has(on)) {
    throw new TypeError(
      `captureStack.on must be one of "started", "heartbeat", "both", got ${describeValue(on)}`,
    );
  }

  return Object.freeze({
    mode,
    on,
    maxFrames,
    maxSamples,
  });
}

function normalizeConfig(userConfig = {}) {
  if (userConfig === undefined) {
    userConfig = {};
  }
  if (!isPlainObject(userConfig)) {
    throw new TypeError(
      `config must be a plain object, got ${describeValue(userConfig)}`,
    );
  }

  const config = {
    ...DEFAULTS,
    ...userConfig,
  };

  assertPositiveIntInRange("freezeThresholdMs", config.freezeThresholdMs);
  assertPositiveIntInRange("heartbeatMs", config.heartbeatMs);

  if (!LOG_TARGETS.has(config.logTarget)) {
    throw new TypeError(
      `logTarget must be one of "stderr", "file", "both", got ${describeValue(config.logTarget)}`,
    );
  }

  if (typeof config.logFile !== "string" || config.logFile.trim().length === 0) {
    throw new TypeError(
      `logFile must be a non-empty string, got ${describeValue(config.logFile)}`,
    );
  }

  if (typeof config.logMaxBytes !== "number" || !Number.isInteger(config.logMaxBytes)) {
    throw new TypeError(
      `logMaxBytes must be an integer, got ${describeValue(config.logMaxBytes)}`,
    );
  }
  if (
    config.logMaxBytes < MIN_LOG_MAX_BYTES ||
    config.logMaxBytes > MAX_LOG_MAX_BYTES
  ) {
    throw new RangeError(
      `logMaxBytes must be between ${MIN_LOG_MAX_BYTES} and ${MAX_LOG_MAX_BYTES}, got ${config.logMaxBytes}`,
    );
  }

  let source;
  if (config.source !== undefined) {
    if (typeof config.source !== "string") {
      throw new TypeError(
        `source must be a string, got ${describeValue(config.source)}`,
      );
    }
    source = config.source.trim();
    if (source.length === 0) {
      throw new TypeError("source must be a non-empty string");
    }
    if (source.length > MAX_SOURCE_LENGTH) {
      throw new RangeError(
        `source must be at most ${MAX_SOURCE_LENGTH} characters, got ${source.length}`,
      );
    }
  }

  const normalized = {
    freezeThresholdMs: config.freezeThresholdMs,
    heartbeatMs: config.heartbeatMs,
    logTarget: config.logTarget,
    logFile: config.logFile.trim(),
    logMaxBytes: config.logMaxBytes,
    captureStack: normalizeCaptureStack(config.captureStack),
  };
  if (source !== undefined) {
    normalized.source = source;
  }
  return normalized;
}

module.exports = {
  LIB,
  DEFAULTS,
  DEFAULT_CAPTURE_STACK,
  DEFAULT_CAPTURE_STACK_PROFILE,
  LOG_TARGETS,
  CAPTURE_STACK_ON,
  MIN_MS,
  MAX_MS,
  MIN_STACK_FRAMES,
  MAX_STACK_FRAMES,
  MIN_STACK_SAMPLES,
  MAX_STACK_SAMPLES,
  MAX_SOURCE_LENGTH,
  MIN_LOG_MAX_BYTES,
  MAX_LOG_MAX_BYTES,
  normalizeConfig,
};
