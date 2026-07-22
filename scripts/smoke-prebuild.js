"use strict";

/**
 * Smoke-loads the native addon via node-gyp-build.
 * Resolves ./prebuilds when present (release), otherwise ./build (local/CI rebuild).
 */
const path = require("node:path");
const load = require("node-gyp-build");

const addon = load(path.join(__dirname, ".."));
const required = ["start", "stop", "kick", "isRunning"];

for (const name of required) {
  if (typeof addon[name] !== "function") {
    console.error(`missing export: ${name}`);
    process.exit(1);
  }
}

const started = addon.start(
  {
    freezeThresholdMs: 1000,
    heartbeatMs: 1000,
    logTarget: "file",
    logFile: path.join(require("node:os").tmpdir(), `watchdog-smoke-${process.pid}.log`),
  },
  () => {},
);

if (!started) {
  console.error("start() failed");
  process.exit(1);
}

addon.stop();
console.log("smoke:prebuild ok", process.platform, process.arch);
