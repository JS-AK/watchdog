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

  it("emits freeze_started, heartbeat and freeze_recovered", async () => {
    const events = [];
    const onEvent = (event) => events.push(event);

    watchdog.on("event", onEvent);

    assert.equal(
      watchdog.start({
        freezeThresholdMs: 150,
        heartbeatMs: 100,
        logTarget: "file",
        logFile,
      }),
      true,
    );

    // Let the tick timer settle.
    await sleep(80);
    busyWait(450);
    // Allow queued native->JS callbacks and recovery kick to land.
    await sleep(300);

    watchdog.off("event", onEvent);
    watchdog.stop();

    const types = events.map((e) => e.event);
    assert.ok(types.includes("freeze_started"), `missing started: ${types}`);
    assert.ok(types.includes("freeze_recovered"), `missing recovered: ${types}`);
    assert.ok(
      types.includes("freeze_heartbeat"),
      `missing heartbeat: ${types}`,
    );

    const started = events.find((e) => e.event === "freeze_started");
    const recovered = events.find((e) => e.event === "freeze_recovered");

    assert.equal(started.pid, process.pid);
    assert.ok(started.duration_ms >= 150);
    assert.ok(recovered.duration_ms >= 400);
    assert.equal(started.freeze_id, recovered.freeze_id);
    assert.equal(typeof started.rss_mb, "number");
    assert.ok(started.rss_mb > 0);
    assert.equal(typeof started.cpu_pct, "number");
  });
});
