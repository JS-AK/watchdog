"use strict";

/**
 * Build an ABI-tagged prebuild for the current Node.
 * Must not use prebuildify's default --napi (that targets latest node-abi
 * and produces a single untagged binary — unsafe for V8 stack capture).
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const prebuildify = require.resolve("prebuildify/bin.js");
const target = process.versions.node;
const root = path.join(__dirname, "..");

const result = spawnSync(
  process.execPath,
  [prebuildify, "--strip", "--no-napi", "--target", target],
  { stdio: "inherit", cwd: root },
);

process.exit(result.status ?? 1);
