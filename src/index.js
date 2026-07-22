"use strict";

const { EventEmitter } = require("node:events");
const { DEFAULTS, normalizeConfig } = require("./config");

const WIP = "work in progress";
const EVENT_NAMES = new Set(["freeze", "recovered", "event", "error"]);

const bus = new EventEmitter();
let activeConfig = null;
let running = false;
let wipWarned = false;

function warnWip(method) {
  if (!wipWarned) {
    wipWarned = true;
    console.warn(
      `[@js-ak/watchdog] ${WIP}: native freeze detection is not implemented yet (${method})`,
    );
  }
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
  warnWip("start");
  const config = normalizeConfig(userConfig);
  if (running) {
    return false;
  }
  activeConfig = Object.freeze({ ...config });
  running = true;
  return true;
}

function stop() {
  warnWip("stop");
  activeConfig = null;
  running = false;
}

function isRunning() {
  warnWip("isRunning");
  return running;
}

function getConfig() {
  warnWip("getConfig");
  return activeConfig;
}

function on(event, listener) {
  warnWip("on");
  assertEventName(event);
  assertListener(listener);
  bus.on(event, listener);
  return api;
}

function once(event, listener) {
  warnWip("once");
  assertEventName(event);
  assertListener(listener);
  bus.once(event, listener);
  return api;
}

function off(event, listener) {
  warnWip("off");
  assertEventName(event);
  assertListener(listener);
  bus.off(event, listener);
  return api;
}

function removeAllListeners(event) {
  warnWip("removeAllListeners");
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
  /** Stub marker until native core lands. */
  status: WIP,
};

module.exports = api;
