"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const watchdog = require("../src/index.js");

describe("@js-ak/watchdog stub", () => {
  it("exposes WIP status and DEFAULTS", () => {
    assert.equal(watchdog.status, "work in progress");
    assert.equal(watchdog.DEFAULTS.freezeThresholdMs, 1000);
    assert.equal(watchdog.DEFAULTS.heartbeatMs, 1000);
    assert.equal(watchdog.DEFAULTS.logTarget, "stderr");
  });

  it("start/stop lifecycle with stub state", () => {
    watchdog.stop();
    assert.equal(watchdog.isRunning(), false);
    assert.equal(watchdog.getConfig(), null);

    assert.equal(watchdog.start(), true);
    assert.equal(watchdog.isRunning(), true);
    assert.equal(watchdog.getConfig().freezeThresholdMs, 1000);
    assert.equal(watchdog.start(), false);

    watchdog.stop();
    assert.equal(watchdog.isRunning(), false);
    assert.equal(watchdog.getConfig(), null);
  });

  it("validates config", () => {
    assert.throws(() => watchdog.start({ freezeThresholdMs: 0 }), RangeError);
    assert.throws(() => watchdog.start({ logTarget: "nowhere" }), TypeError);
  });

  it("subscribes to events without throwing", () => {
    const noop = () => {};
    watchdog.on("freeze", noop).once("recovered", noop).off("freeze", noop);
    watchdog.removeAllListeners();
  });
});
