"use strict";

/**
 * Build an ABI-tagged prebuild for the current Node.
 * Must not use prebuildify's default --napi (that targets latest node-abi
 * and produces a single untagged binary — unsafe for V8 stack capture).
 * Always pass --tag-libc so Linux artifacts are *.glibc.node / *.musl.node
 * (Alpine must not load Ubuntu glibc binaries).
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const prebuildify = require.resolve("prebuildify/bin.js");
const target = process.versions.node;
const root = path.join(__dirname, "..");

// --tag-libc: linux builds become *.glibc.node / *.musl.node so Alpine (musl)
// never loads an Ubuntu glibc prebuild (loads + later SIGSEGV on V8 APIs).
const result = spawnSync(
  process.execPath,
  [prebuildify, "--strip", "--no-napi", "--tag-libc", "--target", target],
  { stdio: "inherit", cwd: root },
);

process.exit(result.status ?? 1);
