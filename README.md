# @js-ak/watchdog

Native watchdog for Node.js that detects event loop freezes with near-zero overhead.

> Status: native event-loop freeze detector (N-API). Prebuilds ship for major platforms on release.

## Install

```bash
npm install @js-ak/watchdog
```

Published builds include ABI-tagged prebuilds for `win32-x64`, `linux-x64`, `linux-arm64`, `darwin-arm64`, and `darwin-x64` (Node 22 / 24 / 26). `npm install` loads the matching ABI — no C++ toolchain needed on those targets.

`captureStack` needs a matching `NODE_MODULE_VERSION` prebuild (same rule Node uses for native addons). All patches within a shipped major share one ABI; an unsupported major disables capture with a warning until that ABI is published.

Linux prebuilds are produced on Ubuntu 22.04 for broader `libstdc++` compatibility with Debian bookworm / slim images.

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
| `source` | omit | optional app/service label (max 256 chars); included on native JSON Lines and JS events when set. Library identity is always `lib: "js-ak/watchdog"` |
| `captureStack` | `false` | opt-in JS stack capture (unstable). `true` or `{ mode, on, maxFrames }` — see below |

### `captureStack` (experimental)

Uses V8 `RequestInterrupt` to sample the JS stack when a freeze is detected. Works best for JS busy-loops; sync I/O / native blocks may leave `stack_status: "unavailable"`.

Stack capture calls V8 C++ APIs. Release CI ships one ABI-tagged binary per supported Node major; `node-gyp-build` picks the match at install/load time.

| Value | Meaning |
| --- | --- |
| `false` / omit | disabled (default) |
| `true` | `{ mode: "interrupt", on: "started", maxFrames: 50 }` |
| `{ mode, on, maxFrames }` | `mode`: `"interrupt"` only; `on`: `"started"` \| `"heartbeat"` \| `"both"`; `maxFrames`: `1..256` |

When enabled, native logs / JS events may include:

- `freeze_stack` — live sample (`channel: "freeze"`); `rss_mb` / `cpu_pct` are copied from the latest lifecycle event (started/heartbeat), not re-sampled
- on `freeze_recovered`: `stack_status`, `stack_mode`, and `stack` only when status is `"ok"`
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
  // stack_mode: "interrupt",
  // stack: ["at busyWait (test.js:12:5)", ...], // omitted when unavailable
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
| No `freeze_stack` / `stack_status: "unavailable"` | Sync I/O, native addon, or interrupt never reached a V8 safepoint | Expected for non-JS blocks; check native logs around recovery; try `on: "both"` for retries |
| `captureStack` off + ABI warning | No prebuild for this Node major / wrong binary loaded | Use Node 22/24/26, or upgrade `@js-ak/watchdog` once that ABI is published |
| `npm ci` in Debian slim tries to compile / needs Python | Linux prebuild needs newer `libstdc++` than the image, so load fails and install falls back to `node-gyp` | Use a newer base image, or upgrade `@js-ak/watchdog` (Ubuntu 22.04 prebuilds) |

## Compatibility

See [COMPATIBILITY.md](./COMPATIBILITY.md) for the v1 stability contract.

## Docs

- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [COMPATIBILITY.md](./COMPATIBILITY.md)
