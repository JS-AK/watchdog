"use strict";

/**
 * Demo: file sink + soft size rotation (`logMaxBytes`).
 *
 * Run from repo root (needs a built addon):
 *   node examples/log-max-bytes.js
 *
 * Not published: `package.json` `"files"` whitelist omits `examples/`.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const watchdog = require("../src/index.js");

const logFile = path.join(
  os.tmpdir(),
  `watchdog-example-${process.pid}.log`,
);
const backupFile = `${logFile}.1`;

for (const file of [logFile, backupFile]) {
  try {
    fs.unlinkSync(file);
  } catch {
    // ignore missing
  }
}

watchdog.on("freeze", (event) => {
  console.log("[js]", event.event, `duration_ms=${event.duration_ms}`);
});

watchdog.on("recovered", (event) => {
  console.log("[js]", event.event, `duration_ms=${event.duration_ms}`);
});

const started = watchdog.start({
  freezeThresholdMs: 100,
  heartbeatMs: 50,
  logTarget: "file",
  logFile,
  // Tiny cap so a short freeze rotates to <logFile>.1 (production default: 10 MiB).
  logMaxBytes: 800,
  source: "example-log-max-bytes",
});

if (!started) {
  console.error("watchdog already running");
  process.exit(1);
}

console.log("logFile:", logFile);
console.log("blocking event loop to generate heartbeats…");

const end = Date.now() + 600;
while (Date.now() < end) {
  // intentional freeze
}

setTimeout(() => {
  watchdog.stop();

  const activeSize = fs.existsSync(logFile) ? fs.statSync(logFile).size : 0;
  const backupSize = fs.existsSync(backupFile)
    ? fs.statSync(backupFile).size
    : 0;

  console.log("active bytes:", activeSize, fs.existsSync(logFile) ? logFile : "(missing)");
  console.log(
    "backup bytes:",
    backupSize,
    fs.existsSync(backupFile) ? backupFile : "(no rotation yet — raise freeze duration)",
  );

  if (fs.existsSync(logFile)) {
    const lines = fs
      .readFileSync(logFile, "utf8")
      .split(/\r?\n/)
      .filter(Boolean);
    console.log("active lines:", lines.length);
  }
}, 200);
