"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const watchdog = require("../src/index.js");
const { normalizeConfig } = require("../src/config.js");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function busyWait(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // intentionally block the event loop
  }
}

describe("captureStack config", () => {
  it("defaults to false", () => {
    assert.equal(normalizeConfig({}).captureStack, false);
  });

  it("expands true to interrupt defaults", () => {
    assert.deepEqual(normalizeConfig({ captureStack: true }).captureStack, {
      mode: "interrupt",
      on: "started",
      maxFrames: 50,
    });
  });

  it("rejects unknown mode / on / maxFrames", () => {
    assert.throws(
      () => normalizeConfig({ captureStack: { mode: "report" } }),
      TypeError,
    );
    assert.throws(
      () => normalizeConfig({ captureStack: { on: "always" } }),
      TypeError,
    );
    assert.throws(
      () => normalizeConfig({ captureStack: { maxFrames: 0 } }),
      RangeError,
    );
  });
});

describe("captureStack interrupt", () => {
  const logFile = path.join(
    os.tmpdir(),
    `watchdog-stack-${process.pid}-${Date.now()}.log`,
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

  it("emits freeze_stack and attaches last stack on recovered", async () => {
    const events = [];
    const onEvent = (event) => events.push(event);
    watchdog.on("event", onEvent);

    assert.equal(
      watchdog.start({
        freezeThresholdMs: 120,
        heartbeatMs: 80,
        logTarget: "file",
        logFile,
        captureStack: true,
      }),
      true,
    );

    await sleep(60);
    busyWait(350);
    await sleep(300);

    watchdog.off("event", onEvent);
    watchdog.stop();

    const types = events.map((event) => event.event);
    assert.ok(types.includes("freeze_started"), `missing started: ${types}`);
    assert.ok(types.includes("freeze_stack"), `missing freeze_stack: ${types}`);
    assert.ok(types.includes("freeze_recovered"), `missing recovered: ${types}`);

    const stackEvent = events.find((event) => event.event === "freeze_stack");
    assert.equal(stackEvent.stack_status, "ok");
    assert.equal(stackEvent.stack_mode, "interrupt");
    assert.ok(Array.isArray(stackEvent.stack));
    assert.ok(stackEvent.stack.length > 0);
    assert.ok(
      stackEvent.stack.some((frame) => /busyWait|Date\.now|at /.test(frame)),
      `unexpected frames: ${JSON.stringify(stackEvent.stack.slice(0, 5))}`,
    );

    const started = events.find((event) => event.event === "freeze_started");
    assert.equal(stackEvent.cpu_pct, started.cpu_pct);
    assert.equal(stackEvent.rss_mb, started.rss_mb);

    const recovered = events.find((event) => event.event === "freeze_recovered");
    assert.equal(recovered.stack_status, "ok");
    assert.ok(Array.isArray(recovered.stack));
    assert.ok(recovered.stack.length > 0);
    assert.equal(recovered.freeze_id, stackEvent.freeze_id);

    const lines = fs
      .readFileSync(logFile, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    assert.ok(lines.some((event) => event.event === "freeze_stack"));
    const recoveredLine = lines.find(
      (event) => event.event === "freeze_recovered",
    );
    assert.ok(recoveredLine);
    assert.equal(recoveredLine.stack_status, "ok");
    assert.ok(Array.isArray(recoveredLine.stack));
  });
});
