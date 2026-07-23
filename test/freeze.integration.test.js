"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const watchdog = require("../src/index.js");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function busyWait(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // intentionally block the event loop
  }
}

describe("freeze detection", () => {
  const logFile = path.join(
    os.tmpdir(),
    `watchdog-freeze-${process.pid}-${Date.now()}.log`,
  );

  before(() => {
    watchdog.stop();
    watchdog.removeAllListeners();
  });

  after(() => {
    watchdog.stop();
    watchdog.removeAllListeners();
    try {
      fs.unlinkSync(logFile);
    } catch {
      // ignore
    }
  });

  it("emits freeze_started and freeze_recovered; heartbeat stays in logs", async () => {
    const events = [];
    const onEvent = (event) => events.push(event);

    watchdog.on("event", onEvent);

    assert.equal(
      watchdog.start({
        freezeThresholdMs: 120,
        heartbeatMs: 80,
        logTarget: "file",
        logFile,
      }),
      true,
    );

    // Let the tick timer settle.
    await sleep(80);
    // Keep blocked long enough for: threshold → ≥1 native heartbeat → recover.
    // Heartbeat is armed at freeze_started, so the post-start window must
    // exceed heartbeatMs even if the monitor wakes late (20ms poll).
    busyWait(700);
    // Allow queued native->JS callbacks and recovery kick to land.
    await sleep(300);

    watchdog.off("event", onEvent);
    watchdog.stop();

    const types = events.map((e) => e.event);
    assert.ok(types.includes("freeze_started"), `missing started: ${types}`);
    assert.ok(types.includes("freeze_recovered"), `missing recovered: ${types}`);
    assert.ok(
      !types.includes("freeze_heartbeat"),
      `heartbeat must not bridge to JS: ${types}`,
    );

    const logLines = fs
      .readFileSync(logFile, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const logTypes = logLines.map((e) => e.event);
    assert.ok(
      logTypes.includes("freeze_heartbeat"),
      `missing native heartbeat log: ${logTypes}`,
    );

    const started = events.find((e) => e.event === "freeze_started");
    const recovered = events.find((e) => e.event === "freeze_recovered");

    assert.equal(started.pid, process.pid);
    assert.ok(started.duration_ms >= 120);
    assert.ok(recovered.duration_ms >= 500);
    assert.equal(started.freeze_id, recovered.freeze_id);
    assert.equal(typeof started.rss_mb, "number");
    assert.ok(started.rss_mb > 0);
    assert.equal(typeof started.cpu_pct, "number");
  });
});
