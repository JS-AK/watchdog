"use strict";

const DEFAULTS = Object.freeze({
  freezeThresholdMs: 1000,
  heartbeatMs: 1000,
  logLevel: "info",
  logTarget: "stderr",
  logFile: "./watchdog.log",
});

const LOG_TARGETS = new Set(["stderr", "file", "both"]);
const LOG_LEVELS = new Set(["debug", "info", "warn", "error"]);

const MIN_MS = 1;
const MAX_MS = 3_600_000; // 1 hour

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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

  if (!LOG_LEVELS.has(config.logLevel)) {
    throw new TypeError(
      `logLevel must be one of "debug", "info", "warn", "error", got ${describeValue(config.logLevel)}`,
    );
  }

  if (typeof config.logFile !== "string" || config.logFile.trim().length === 0) {
    throw new TypeError(
      `logFile must be a non-empty string, got ${describeValue(config.logFile)}`,
    );
  }

  return {
    freezeThresholdMs: config.freezeThresholdMs,
    heartbeatMs: config.heartbeatMs,
    logLevel: config.logLevel,
    logTarget: config.logTarget,
    logFile: config.logFile.trim(),
  };
}

module.exports = {
  DEFAULTS,
  LOG_TARGETS,
  LOG_LEVELS,
  MIN_MS,
  MAX_MS,
  normalizeConfig,
};
