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
      on: "both",
      maxFrames: 50,
      maxSamples: 8,
    });
  });

  it("rejects unknown mode / on / maxFrames / maxSamples", () => {
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
    assert.throws(
      () => normalizeConfig({ captureStack: { maxSamples: 0 } }),
      RangeError,
    );
    assert.throws(
      () => normalizeConfig({ captureStack: { maxSamples: 33 } }),
      RangeError,
    );
    assert.throws(
      () => normalizeConfig({ captureStack: { maxSamples: 1.5 } }),
      TypeError,
    );
  });

  it("accepts maxSamples in range", () => {
    assert.equal(
      normalizeConfig({ captureStack: { maxSamples: 1 } }).captureStack
        .maxSamples,
      1,
    );
    assert.equal(
      normalizeConfig({ captureStack: { maxSamples: 32 } }).captureStack
        .maxSamples,
      32,
    );
  });

  it("accepts profile mode and ignores on", () => {
    assert.deepEqual(
      normalizeConfig({
        captureStack: { mode: "profile", on: "started", maxSamples: 4 },
      }).captureStack,
      {
        mode: "profile",
        on: "both",
        maxFrames: 50,
        maxSamples: 4,
      },
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
    assert.ok(Array.isArray(recovered.stack_samples));
    assert.ok(recovered.stack_samples.length >= 1);
    assert.equal(recovered.stack_samples[0].count >= 1, true);
    assert.deepEqual(recovered.stack, recovered.stack_samples[0].stack);

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
    assert.ok(Array.isArray(recoveredLine.stack_samples));
    assert.ok(recoveredLine.stack_samples.length >= 1);
  });

  it("aggregates multiple interrupt samples on long freeze", async () => {
    const events = [];
    const onEvent = (event) => events.push(event);
    watchdog.on("event", onEvent);

    assert.equal(
      watchdog.start({
        freezeThresholdMs: 80,
        heartbeatMs: 40,
        logTarget: "file",
        logFile,
        captureStack: { on: "both", maxSamples: 8 },
      }),
      true,
    );

    await sleep(40);
    // Long enough for several heartbeats even on slow CI runners; pending
    // freeze_stack may coalesce to fewer JS events than interrupt samples.
    busyWait(900);
    await sleep(400);

    watchdog.off("event", onEvent);
    watchdog.stop();

    const freezeStacks = events.filter(
      (event) => event.event === "freeze_stack",
    );
    assert.ok(
      freezeStacks.length >= 1,
      `expected at least one freeze_stack, got ${freezeStacks.length}`,
    );

    const recovered = events.find((event) => event.event === "freeze_recovered");
    assert.ok(recovered);
    assert.equal(recovered.stack_status, "ok");
    assert.ok(Array.isArray(recovered.stack_samples));
    assert.ok(recovered.stack_samples.length >= 1);

    const totalCount = recovered.stack_samples.reduce(
      (sum, sample) => sum + sample.count,
      0,
    );
    assert.ok(
      totalCount >= 2,
      `expected aggregated count >= 2, got ${totalCount}: ${JSON.stringify(recovered.stack_samples)}`,
    );
    assert.deepEqual(recovered.stack, recovered.stack_samples[0].stack);

    for (let i = 1; i < recovered.stack_samples.length; i += 1) {
      assert.ok(
        recovered.stack_samples[i - 1].count >=
          recovered.stack_samples[i].count,
      );
    }
  });
});

describe("captureStack profile", () => {
  const logFile = path.join(
    os.tmpdir(),
    `watchdog-profile-${process.pid}-${Date.now()}.log`,
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

  it("attaches CpuProfiler hot paths on recovered", async () => {
    const events = [];
    const onEvent = (event) => events.push(event);
    watchdog.on("event", onEvent);

    assert.equal(
      watchdog.start({
        freezeThresholdMs: 100,
        heartbeatMs: 80,
        logTarget: "file",
        logFile,
        captureStack: { mode: "profile", maxSamples: 8 },
      }),
      true,
    );

    await sleep(40);
    // Long busy-wait so early-arm (threshold/2) and freeze both see JS samples.
    busyWait(700);
    await sleep(400);

    watchdog.off("event", onEvent);
    watchdog.stop();

    const types = events.map((event) => event.event);
    assert.ok(types.includes("freeze_started"), `missing started: ${types}`);
    assert.ok(types.includes("freeze_recovered"), `missing recovered: ${types}`);
    assert.equal(
      types.includes("freeze_stack"),
      false,
      `profile mode should not emit freeze_stack: ${types}`,
    );

    const recovered = events.find((event) => event.event === "freeze_recovered");
    assert.ok(recovered);
    assert.equal(recovered.stack_mode, "profile");
    assert.equal(recovered.stack_status, "ok");
    assert.ok(Array.isArray(recovered.stack));
    assert.ok(recovered.stack.length > 0);
    assert.ok(Array.isArray(recovered.stack_samples));
    assert.ok(recovered.stack_samples.length >= 1);
    assert.ok(recovered.stack_samples[0].count >= 1);
    assert.deepEqual(recovered.stack, recovered.stack_samples[0].stack);
    assert.ok(
      recovered.stack_samples.some((sample) =>
        sample.stack.some((frame) => /busyWait|Date\.now|at /.test(frame)),
      ),
      `unexpected profile frames: ${JSON.stringify(recovered.stack_samples.slice(0, 3))}`,
    );

    const lines = fs
      .readFileSync(logFile, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const recoveredLine = lines.find(
      (event) => event.event === "freeze_recovered",
    );
    assert.ok(recoveredLine);
    assert.equal(recoveredLine.stack_mode, "profile");
    assert.equal(recoveredLine.stack_status, "ok");
    assert.ok(Array.isArray(recoveredLine.stack_samples));
  });
});
