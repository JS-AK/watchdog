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

describe("hardening: start/stop stress", () => {
  before(() => {
    watchdog.stop();
    watchdog.removeAllListeners();
  });

  after(() => {
    watchdog.stop();
    watchdog.removeAllListeners();
  });

  it("survives rapid start/stop cycles", () => {
    const logFile = path.join(
      os.tmpdir(),
      `watchdog-stress-cycle-${process.pid}.log`,
    );

    for (let i = 0; i < 30; i += 1) {
      assert.equal(
        watchdog.start({
          freezeThresholdMs: 200,
          heartbeatMs: 100,
          logTarget: "file",
          logFile,
        }),
        true,
        `start failed on iteration ${i}`,
      );
      assert.equal(watchdog.isRunning(), true);
      watchdog.stop();
      assert.equal(watchdog.isRunning(), false);
    }

    try {
      fs.unlinkSync(logFile);
    } catch {
      // ignore
    }
  });
});

describe("hardening: repeated freezes", () => {
  const logFile = path.join(
    os.tmpdir(),
    `watchdog-stress-freeze-${process.pid}-${Date.now()}.log`,
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

  it("detects multiple sequential freezes", async () => {
    const recovered = [];
    watchdog.on("recovered", (event) => recovered.push(event));

    assert.equal(
      watchdog.start({
        freezeThresholdMs: 120,
        heartbeatMs: 80,
        logTarget: "file",
        logFile,
      }),
      true,
    );

    await sleep(60);
    busyWait(280);
    await sleep(200);
    busyWait(280);
    await sleep(200);
    busyWait(280);
    await sleep(250);

    watchdog.stop();

    assert.ok(
      recovered.length >= 3,
      `expected >=3 recoveries, got ${recovered.length}`,
    );

    const freezeIds = recovered.map((event) => event.freeze_id);
    assert.equal(new Set(freezeIds).size, freezeIds.length);
    for (const event of recovered) {
      assert.ok(event.duration_ms >= 200);
      assert.ok(event.rss_mb > 0);
    }
  });
});

describe("hardening: failure modes", () => {
  before(() => {
    watchdog.stop();
    watchdog.removeAllListeners();
  });

  after(() => {
    watchdog.stop();
    watchdog.removeAllListeners();
  });

  it("does not crash when log file path is not writable", async () => {
    const badPath = path.join(
      os.tmpdir(),
      `watchdog-missing-${process.pid}-${Date.now()}`,
      "nested",
      "watchdog.log",
    );

    const events = [];
    watchdog.on("event", (event) => events.push(event));

    assert.equal(
      watchdog.start({
        freezeThresholdMs: 120,
        heartbeatMs: 80,
        logTarget: "file",
        logFile: badPath,
      }),
      true,
    );

    await sleep(50);
    busyWait(260);
    await sleep(200);
    watchdog.stop();

    const types = events.map((event) => event.event);
    assert.ok(types.includes("freeze_started"), `missing started: ${types}`);
    assert.ok(types.includes("freeze_recovered"), `missing recovered: ${types}`);
    assert.equal(fs.existsSync(badPath), false);
  });

  it("emits freeze_recovered when stopped during a freeze", async () => {
    const logFile = path.join(
      os.tmpdir(),
      `watchdog-stop-freeze-${process.pid}-${Date.now()}.log`,
    );
    const events = [];
    const onEvent = (event) => events.push(event);
    watchdog.on("event", onEvent);

    assert.equal(
      watchdog.start({
        freezeThresholdMs: 100,
        heartbeatMs: 80,
        logTarget: "file",
        logFile,
      }),
      true,
    );

    await sleep(40);
    busyWait(280);
    watchdog.stop();
    // Allow released TSFN callbacks to drain onto the event loop.
    await sleep(80);

    watchdog.off("event", onEvent);

    const types = events.map((event) => event.event);
    assert.ok(types.includes("freeze_started"), `missing started: ${types}`);
    assert.ok(
      types.includes("freeze_recovered"),
      `missing recovered on stop: ${types}`,
    );

    const lines = fs
      .readFileSync(logFile, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    assert.ok(lines.some((event) => event.event === "freeze_recovered"));

    try {
      fs.unlinkSync(logFile);
    } catch {
      // ignore
    }
  });

  it("keeps process alive after invalid start config", () => {
    assert.throws(
      () =>
        watchdog.start({
          freezeThresholdMs: -1,
        }),
      RangeError,
    );
    assert.equal(watchdog.isRunning(), false);
    assert.equal(watchdog.getConfig(), null);
  });
});
