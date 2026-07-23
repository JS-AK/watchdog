"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");

const watchdog = require("../src/index.js");
const { normalizeConfig, DEFAULTS, MAX_MS } = require("../src/config.js");

describe("config", () => {
  it("applies defaults", () => {
    const config = normalizeConfig({});
    assert.equal(config.freezeThresholdMs, DEFAULTS.freezeThresholdMs);
    assert.equal(config.heartbeatMs, DEFAULTS.heartbeatMs);
    assert.equal(config.logTarget, "stderr");
  });

  it("trims logFile", () => {
    const config = normalizeConfig({ logFile: "  ./x.log  " });
    assert.equal(config.logFile, "./x.log");
  });

  it("rejects invalid freezeThresholdMs", () => {
    assert.throws(() => normalizeConfig({ freezeThresholdMs: 0 }), RangeError);
    assert.throws(() => normalizeConfig({ freezeThresholdMs: 1.5 }), TypeError);
    assert.throws(
      () => normalizeConfig({ freezeThresholdMs: MAX_MS + 1 }),
      RangeError,
    );
  });

  it("rejects non-object config", () => {
    assert.throws(() => normalizeConfig(null), TypeError);
    assert.throws(() => normalizeConfig([]), TypeError);
    assert.throws(() => normalizeConfig("nope"), TypeError);
  });

  it("rejects invalid logTarget", () => {
    assert.throws(() => normalizeConfig({ logTarget: "memory" }), TypeError);
  });

  it("applies and validates logMaxBytes", () => {
    assert.equal(normalizeConfig({}).logMaxBytes, DEFAULTS.logMaxBytes);
    assert.equal(normalizeConfig({ logMaxBytes: 0 }).logMaxBytes, 0);
    assert.equal(normalizeConfig({ logMaxBytes: 4096 }).logMaxBytes, 4096);
    assert.throws(() => normalizeConfig({ logMaxBytes: -1 }), RangeError);
    assert.throws(() => normalizeConfig({ logMaxBytes: 1.5 }), TypeError);
  });

  it("accepts optional source and trims it", () => {
    assert.equal(normalizeConfig({}).source, undefined);
    assert.equal(normalizeConfig({ source: "  api  " }).source, "api");
  });

  it("rejects invalid source", () => {
    assert.throws(() => normalizeConfig({ source: "" }), TypeError);
    assert.throws(() => normalizeConfig({ source: "   " }), TypeError);
    assert.throws(() => normalizeConfig({ source: 1 }), TypeError);
    assert.throws(
      () => normalizeConfig({ source: "x".repeat(257) }),
      RangeError,
    );
  });
});

describe("api surface", () => {
  before(() => {
    watchdog.stop();
    watchdog.removeAllListeners();
  });

  after(() => {
    watchdog.stop();
    watchdog.removeAllListeners();
  });

  it("exposes DEFAULTS and getConfig lifecycle", () => {
    assert.equal(watchdog.DEFAULTS.freezeThresholdMs, 1000);
    assert.equal(watchdog.getConfig(), null);

    assert.equal(
      watchdog.start({
        freezeThresholdMs: 500,
        heartbeatMs: 200,
        logTarget: "file",
        logFile: "./tmp-watchdog.log",
      }),
      true,
    );

    const config = watchdog.getConfig();
    assert.ok(config);
    assert.equal(config.freezeThresholdMs, 500);
    assert.equal(config.heartbeatMs, 200);
    assert.equal(config.logFile, require("node:path").resolve("./tmp-watchdog.log"));
    assert.equal(watchdog.start({ freezeThresholdMs: 500 }), false);

    watchdog.stop();
    assert.equal(watchdog.getConfig(), null);
    assert.equal(watchdog.isRunning(), false);
  });

  it("validates event names and supports once/off", async () => {
    assert.throws(() => watchdog.on("nope", () => { }), TypeError);
    assert.throws(() => watchdog.on("error", () => { }), TypeError);
    assert.throws(() => watchdog.on("freeze", null), TypeError);

    let hits = 0;
    const listener = () => {
      hits += 1;
    };

    watchdog.once("event", listener);
    watchdog._bus.emit("event", { event: "freeze_started" });
    watchdog._bus.emit("event", { event: "freeze_started" });
    assert.equal(hits, 1);

    watchdog.on("freeze", listener);
    watchdog.off("freeze", listener);
    watchdog._bus.emit("freeze", { event: "freeze_started" });
    assert.equal(hits, 1);

    watchdog.on("recovered", listener);
    watchdog.removeAllListeners("recovered");
    watchdog._bus.emit("recovered", { event: "freeze_recovered" });
    assert.equal(hits, 1);
  });
});
