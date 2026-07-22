"use strict";

const { EventEmitter } = require("node:events");
const loadAddon = require("node-gyp-build");
const path = require("node:path");
const { normalizeConfig, DEFAULTS } = require("./config");

const EVENT_NAMES = new Set(["freeze", "recovered", "event"]);

const addon = loadAddon(path.join(__dirname, ".."));
const bus = new EventEmitter();

let tickTimer = null;
let activeConfig = null;

function enrich(nativeEvent) {
  const payload = {
    ts: new Date().toISOString(),
    pid: nativeEvent.pid || process.pid,
    event: nativeEvent.event,
    freeze_id: nativeEvent.freeze_id,
    duration_ms: nativeEvent.duration_ms,
    threshold_ms: nativeEvent.threshold_ms,
    heartbeat_ms: nativeEvent.heartbeat_ms,
    sequence: nativeEvent.sequence,
    rss_mb: nativeEvent.rss_mb,
    cpu_pct: nativeEvent.cpu_pct,
  };

  if (nativeEvent.stack_status !== undefined) {
    payload.stack_status = nativeEvent.stack_status;
    if (nativeEvent.stack_mode !== undefined) {
      payload.stack_mode = nativeEvent.stack_mode;
    }
    if (Array.isArray(nativeEvent.stack)) {
      payload.stack = nativeEvent.stack;
    }
  }

  return payload;
}

function onNativeEvent(nativeEvent) {
  const payload = enrich(nativeEvent);
  const channel = nativeEvent.channel || "freeze";
  bus.emit(channel, payload);
  bus.emit("event", payload);
}

function assertEventName(event) {
  if (typeof event !== "string" || !EVENT_NAMES.has(event)) {
    throw new TypeError(
      `event must be one of ${[...EVENT_NAMES].map((name) => `"${name}"`).join(", ")}`,
    );
  }
}

function assertListener(listener) {
  if (typeof listener !== "function") {
    throw new TypeError("listener must be a function");
  }
}

function start(userConfig = {}) {
  let config = normalizeConfig(userConfig);
  const resolvedLogFile = path.resolve(config.logFile);

  // captureStack uses V8 C++ APIs. Published packages ship ABI-tagged
  // prebuilds; node-gyp-build should load a matching one. Mismatch means
  // this Node major has no shipped prebuild yet (or a wrong binary loaded).
  if (config.captureStack) {
    const builtAbi = addon.builtWithModules;
    const runtimeAbi = Number(process.versions.modules);
    if (typeof builtAbi === "number" && builtAbi !== runtimeAbi) {
      process.emitWarning(
        `captureStack disabled: no matching ABI prebuild ` +
          `(addon ${builtAbi}, runtime ${runtimeAbi} / Node ${process.version}). ` +
          `Use a supported Node major or upgrade @js-ak/watchdog.`,
        "@js-ak/watchdog",
      );
      config = { ...config, captureStack: false };
    }
  }

  const started = addon.start(
    {
      freezeThresholdMs: config.freezeThresholdMs,
      heartbeatMs: config.heartbeatMs,
      logTarget: config.logTarget,
      logFile: resolvedLogFile,
      captureStack: config.captureStack,
    },
    onNativeEvent,
  );

  if (!started) {
    return false;
  }

  activeConfig = Object.freeze({ ...config, logFile: resolvedLogFile });

  if (tickTimer) {
    clearInterval(tickTimer);
  }

  // Event-loop progress marker. Native side compares this kick lag to threshold.
  tickTimer = setInterval(() => {
    addon.kick();
  }, Math.min(50, Math.max(10, Math.floor(config.freezeThresholdMs / 20))));

  if (typeof tickTimer.unref === "function") {
    tickTimer.unref();
  }

  return true;
}

function stop() {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
  addon.stop();
  activeConfig = null;
}

function isRunning() {
  return addon.isRunning();
}

function getConfig() {
  return activeConfig;
}

function on(event, listener) {
  assertEventName(event);
  assertListener(listener);
  bus.on(event, listener);
  return api;
}

function once(event, listener) {
  assertEventName(event);
  assertListener(listener);
  bus.once(event, listener);
  return api;
}

function off(event, listener) {
  assertEventName(event);
  assertListener(listener);
  bus.off(event, listener);
  return api;
}

function removeAllListeners(event) {
  if (event === undefined) {
    bus.removeAllListeners();
    return api;
  }
  assertEventName(event);
  bus.removeAllListeners(event);
  return api;
}

const api = {
  start,
  stop,
  isRunning,
  getConfig,
  on,
  once,
  off,
  removeAllListeners,
  DEFAULTS,
  // Internal helpers for tests. Not part of the stable public API.
  _bus: bus,
  _addon: addon,
};

module.exports = api;
