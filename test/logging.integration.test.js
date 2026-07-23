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

describe("native logging", () => {
  const logFile = path.join(
    os.tmpdir(),
    `watchdog-m2-${process.pid}-${Date.now()}.log`,
  );

  before(() => {
    watchdog.stop();
    try {
      fs.unlinkSync(logFile);
    } catch {
      // ignore
    }
  });

  after(() => {
    watchdog.stop();
    for (const file of [logFile, `${logFile}.1`]) {
      try {
        fs.unlinkSync(file);
      } catch {
        // ignore
      }
    }
  });

  it("writes JSON lines with metrics during freeze", async () => {
    assert.equal(
      watchdog.start({
        freezeThresholdMs: 150,
        heartbeatMs: 100,
        logTarget: "file",
        logFile,
        source: "logging-test",
      }),
      true,
    );

    await sleep(80);
    busyWait(450);
    await sleep(300);
    watchdog.stop();

    assert.ok(fs.existsSync(logFile), "log file was not created");
    const lines = fs
      .readFileSync(logFile, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    assert.ok(lines.length >= 2, `expected >=2 log lines, got ${lines.length}`);

    const events = lines.map((line) => JSON.parse(line));
    const types = events.map((e) => e.event);

    assert.ok(types.includes("freeze_started"), `missing started: ${types}`);
    assert.ok(types.includes("freeze_recovered"), `missing recovered: ${types}`);

    for (const event of events) {
      assert.equal(typeof event.ts, "string");
      assert.equal(event.lib, "js-ak/watchdog");
      assert.equal(event.source, "logging-test");
      assert.equal(event.pid, process.pid);
      assert.equal(typeof event.duration_ms, "number");
      assert.equal(typeof event.rss_mb, "number");
      assert.ok(event.rss_mb > 0);
      assert.equal(typeof event.cpu_pct, "number");
    }

    const recovered = events.find((e) => e.event === "freeze_recovered");
    assert.ok(recovered.duration_ms >= 400);
  });

  it("rotates to <logFile>.1 when logMaxBytes is exceeded", async () => {
    const backup = `${logFile}.1`;
    for (const file of [logFile, backup]) {
      try {
        fs.unlinkSync(file);
      } catch {
        // ignore
      }
    }

    assert.equal(
      watchdog.start({
        freezeThresholdMs: 80,
        heartbeatMs: 40,
        logTarget: "file",
        logFile,
        // Tiny cap so a few heartbeat lines force rotation.
        logMaxBytes: 400,
      }),
      true,
    );

    await sleep(60);
    // Long freeze → many native heartbeats → file grows past the soft cap.
    busyWait(500);
    await sleep(250);
    watchdog.stop();

    assert.ok(fs.existsSync(backup), "expected rotated backup <logFile>.1");
    assert.ok(fs.existsSync(logFile), "expected active log after rotation");

    const activeSize = fs.statSync(logFile).size;
    const backupSize = fs.statSync(backup).size;
    assert.ok(backupSize > 0, "backup should contain prior lines");
    assert.ok(
      activeSize <= 400 || activeSize < backupSize,
      `active log should be capped after rotate, got active=${activeSize} backup=${backupSize}`,
    );

    const activeLines = fs
      .readFileSync(logFile, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    for (const line of activeLines) {
      JSON.parse(line);
    }
  });
});
