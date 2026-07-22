# @js-ak/watchdog

Native watchdog for Node.js that detects event loop freezes with near-zero overhead.

> Status: native event-loop freeze detector (N-API). Prebuilds ship for major platforms on release.

## Install

```bash
npm install @js-ak/watchdog
```

Published builds include N-API prebuilds for `win32-x64`, `linux-x64`, `linux-arm64`, `darwin-arm64`, and `darwin-x64`, so a C++ toolchain is **not** required for those targets.

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
  // freeze_started | freeze_heartbeat
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
});

if (!started) {
  console.error("watchdog already running");
}

// later
watchdog.stop();
```

Native side writes JSON Lines **from the monitor thread**, so freeze logs appear even while the event loop is blocked. JS callbacks are still queued until recovery.

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
| `heartbeatMs` | `1000` | `1..3600000` |
| `logTarget` | `"stderr"` | `"stderr"` \| `"file"` \| `"both"` |
| `logFile` | `"./watchdog.log"` | used when target is `file`/`both`; `getConfig()` returns the resolved absolute path |

### Event payload

```js
{
  ts: "2026-07-22T13:18:38.696Z", // JS delivery time; native log lines use sample time
  pid: 28440,
  event: "freeze_started", // freeze_started | freeze_heartbeat | freeze_recovered
  freeze_id: 1,
  duration_ms: 170,
  threshold_ms: 1000,
  heartbeat_ms: 1000,
  sequence: 0,
  rss_mb: 44.15,
  cpu_pct: 79.92, // -1 if unavailable
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

## Compatibility

See [COMPATIBILITY.md](./COMPATIBILITY.md) for the v1 stability contract.

## Docs

- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [COMPATIBILITY.md](./COMPATIBILITY.md)
