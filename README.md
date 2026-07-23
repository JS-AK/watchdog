# @js-ak/watchdog

Native watchdog for Node.js that detects event loop freezes with near-zero overhead.

> Status: native event-loop freeze detector (N-API). Prebuilds ship for major platforms on release.

## Install

```bash
npm install @js-ak/watchdog
```

Published builds include ABI-tagged prebuilds for `win32-x64`, `linux-x64`, `linux-arm64`, `darwin-arm64`, and `darwin-x64` (Node 22 / 24 / 26). `npm install` loads the matching ABI — no C++ toolchain needed on those targets.

`captureStack` needs a matching `NODE_MODULE_VERSION` prebuild (same rule Node uses for native addons). All patches within a shipped major share one ABI; an unsupported major disables capture with a warning until that ABI is published.

### Linux: glibc vs musl

On Linux the native addon must match the **C library** of the runtime, not just `linux-x64` / `linux-arm64`:

| Runtime | libc | Prebuild tag | Typical images / hosts |
| --- | --- | --- | --- |
| Debian, Ubuntu, RHEL, most cloud VMs | **glibc** | `*.glibc.node` | `node:*-bookworm`, `node:*-slim`, GitHub `ubuntu-*` |
| Alpine Linux | **musl** | `*.musl.node` | `node:*-alpine` |

`npm install` (via `node-gyp-build`) picks the tagged file automatically — you do not choose it by hand; your OS / Docker base image decides which one you need.

**Why it matters:** a glibc `.node` can sometimes `dlopen` on Alpine and then **SIGSEGV** later (exit **139**), especially with `captureStack` / V8 `RequestInterrupt`. That is why Linux prebuilds are libc-tagged and why Alpine gets its own musl builds.

glibc builds are produced on Ubuntu 22.04 (broader `libstdc++` reach for Debian bookworm / slim). musl builds are produced on Alpine.

From a git checkout (no prebuilds yet):

```bash
npm install
npm run rebuild
```

Requires a C++ toolchain (`node-gyp` / Visual Studio Build Tools on Windows).

## Quick start

```js
const watchdog = require("@js-ak/watchdog");

watchdog.on("freeze", (event) => {
  // freeze_started | freeze_stack (heartbeat is native-log only)
  console.log(event.event, event.duration_ms);
});

watchdog.on("recovered", (event) => {
  console.log("recovered after", event.duration_ms, "ms");
});

const started = watchdog.start({
  freezeThresholdMs: 1000,
  heartbeatMs: 1000,
  logTarget: "stderr", // stderr | file | both
  logFile: "./watchdog.log",
  source: "payments-api", // optional app label for monitoring
});

if (!started) {
  console.error("watchdog already running");
}

// later
watchdog.stop();
```

Native side writes JSON Lines **from the monitor thread**, so freeze logs (including `freeze_heartbeat`) appear even while the event loop is blocked. JS only receives `freeze_started` / `freeze_stack` / `freeze_recovered` (queued until the loop can run again).

## API

| Method | Description |
| --- | --- |
| `start(config?)` | Start monitoring. Returns `false` if already running. |
| `stop()` | Stop monitoring (idempotent). |
| `isRunning()` | Whether the native monitor thread is active. |
| `getConfig()` | Active config (`logFile` absolute), or `null` when stopped. |
| `on(event, listener)` | Subscribe (`freeze`, `recovered`, `event`). |
| `once(event, listener)` | One-shot subscription. |
| `off(event, listener)` | Unsubscribe. |
| `removeAllListeners(event?)` | Clear listeners. |
| `DEFAULTS` | Frozen default config values. |

### Config

| Key | Default | Notes |
| --- | --- | --- |
| `freezeThresholdMs` | `1000` | `1..3600000` |
| `heartbeatMs` | `1000` | `1..3600000`; native log cadence while frozen (not bridged to JS) |
| `logTarget` | `"stderr"` | `"stderr"` \| `"file"` \| `"both"` |
| `logFile` | `"./watchdog.log"` | used when target is `file`/`both`; `getConfig()` returns the resolved absolute path |
| `logMaxBytes` | `10485760` (10 MiB) | soft size cap for the active log file; on overflow rename to `<logFile>.1` (one backup) and reopen; `0` disables; `0..1073741824` |
| `source` | omit | optional app/service label (max 256 chars); included on native JSON Lines and JS events when set. Library identity is always `lib: "js-ak/watchdog"` |
| `captureStack` | `false` | opt-in JS stack capture (unstable). `true` or `{ mode, on, maxFrames, maxSamples }` — see below |

Local demo of size rotation (repo checkout only; not shipped in the npm tarball):

```bash
node examples/log-max-bytes.js
```

### `captureStack` (experimental)

Two modes:

**`interrupt` (default via `true`)** — V8 `RequestInterrupt` snapshots. Works best for JS busy-loops; sync I/O / native blocks may leave `stack_status: "unavailable"`. Under heavy parallel async work, a sample often lands in `processTicksAndRejections` only. Prefer `on: "both"` so longer freezes re-sample; on recovered, `stack` is the most frequent shape and `stack_samples` lists counts. Interrupt stacks show the JS line at the next safepoint — often the statement **after** a long native call (e.g. `JSON.parse`).

**`profile`** — V8 `CpuProfiler` over the stall. Arms when lag ≥ `freezeThresholdMs / 2`, stops on recover (or discards if lag drops without freezing). On recovered, `stack_mode: "profile"` and `stack_samples` are top hot paths by hit count (no live `freeze_stack` spam). Better attribution for CPU-bound work that yields to safepoints while profiling; a single unbroken native call that never yields before recover may still produce a thin/`unavailable` profile. Adds sampling overhead while armed — keep opt-in.

Stack/profile capture uses V8 C++ APIs. Release CI ships one ABI-tagged binary per supported Node major; `node-gyp-build` picks the match at install/load time.

| Value | Meaning |
| --- | --- |
| `false` / omit | disabled (default) |
| `true` | `{ mode: "interrupt", on: "both", maxFrames: 50, maxSamples: 8 }` |
| `{ mode, on, maxFrames, maxSamples }` | `mode`: `"interrupt"` \| `"profile"`; `on` (interrupt only): `"started"` \| `"heartbeat"` \| `"both"`; `maxFrames`: `1..256`; `maxSamples`: `1..32` |

When enabled, native logs / JS events may include:

- `freeze_stack` — interrupt mode live sample (`channel: "freeze"`); `rss_mb` / `cpu_pct` copied from the latest lifecycle event
- on `freeze_recovered`: `stack_status`, `stack_mode` (`"interrupt"` \| `"profile"`), and `stack` when status is `"ok"`; `stack_samples` (`[{ count, stack }, ...]`, count-desc) when samples exist
- frames often contain absolute paths — keep logs access-controlled when capture is on

### Event payload

```js
{
  ts: "2026-07-22T13:18:38.696Z", // JS delivery time; native log lines use sample time
  lib: "js-ak/watchdog", // fixed library identity
  // source: "payments-api", // only when start({ source }) was set
  pid: 28440,
  event: "freeze_started", // JS: freeze_started | freeze_recovered | freeze_stack
                           // native logs also include freeze_heartbeat
  freeze_id: 1,
  duration_ms: 170,
  threshold_ms: 1000,
  heartbeat_ms: 1000,
  sequence: 0,
  rss_mb: 44.15,
  cpu_pct: 79.92, // -1 if unavailable
  // only when captureStack is enabled (on freeze_stack / freeze_recovered):
  // stack_status: "ok" | "unavailable",
  // stack_mode: "interrupt" | "profile",
  // stack: ["at busyWait (test.js:12:5)", ...], // omitted when unavailable
  // on freeze_recovered when samples exist:
  // stack_samples: [{ count: 3, stack: ["at busyWait ..."] }, ...],
}
```

## Troubleshooting

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| `Cannot find module ... watchdog.node` / load error on install | No matching prebuild and no local toolchain | Install on a supported target, or install build tools and `npm rebuild` |
| No JS events during a freeze | Event loop is blocked | Expected: JS listeners fire after recovery; use native JSON logs for in-freeze signal |
| `start()` returns `false` | Already running | Call `stop()` first, or check `isRunning()` |
| Config throws `TypeError` / `RangeError` | Invalid options | See config table; values must be plain object + ranges |
| Log file missing | Unwritable path / missing directories | Logger fails open quietly; stderr/`both` still work; create parent dirs if you need a file |
| High `cpu_pct` during freeze | Busy-loop / CPU-bound block | Expected for sync CPU spins; use with RSS/duration context |
| No `freeze_stack` / `stack_status: "unavailable"` | Sync I/O, native addon, or interrupt never reached a V8 safepoint | Expected for non-JS blocks; check native logs around recovery; try `on: "both"` or `mode: "profile"` |
| `stack_status: "ok"` but only `processTicksAndRejections` / `task_queues` | Interrupt landed in the promise microtask runner under async load | Expected for many concurrent awaits; try `mode: "profile"`; use duration/RSS/CPU; raise `freezeThresholdMs` if short stalls are noise |
| Interrupt stack line is after `JSON.parse` / other native | Interrupt runs at the next safepoint after native returns | Expected; use `mode: "profile"` for hit-count attribution when the profiler was armed in time |
| Profile `unavailable` / empty on short native-only stalls | Profiler start interrupt could not run until after the block | Expected for one unbroken native call; lengthen work or accept interrupt function-level hint |
| `captureStack` off + ABI warning | No prebuild for this Node major / wrong binary loaded | Use Node 22/24/26, or upgrade `@js-ak/watchdog` once that ABI is published |
| `npm ci` in Debian slim tries to compile / needs Python | Linux prebuild needs newer `libstdc++` than the image, so load fails and install falls back to `node-gyp` | Use a newer base image, or upgrade `@js-ak/watchdog` (Ubuntu 22.04 prebuilds) |
| Container exit **139** / SIGSEGV (often with `captureStack`) on Alpine | glibc Linux prebuild loaded on musl | Use a release with libc-tagged + musl prebuilds; or switch to a glibc image (`node:*-bookworm-slim`); or rebuild from source on Alpine after removing `node_modules/@js-ak/watchdog/prebuilds` |

## Compatibility

See [COMPATIBILITY.md](./COMPATIBILITY.md) for the v1 stability contract.

## Docs

- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [COMPATIBILITY.md](./COMPATIBILITY.md)
