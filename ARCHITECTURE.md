# @js-ak/watchdog Architecture

## Overview

The library is an **in-process** N-API addon loaded into the Node.js process.

```text
Node.js process
   │
   ├── require('@js-ak/watchdog')
   │     └── JS kick timer (event-loop progress marker)
   │
   ▼
+---------------------------+
| C++ N-API addon           |
|---------------------------|
| Watchdog monitor thread   |
| Logger                    |
| Metrics sampler           |
| Stack capture (opt-in)    |
+---------------------------+
```

Lifecycle:

1. App calls `watchdog.start(config)`.
2. JS layer starts a kick timer; addon starts the monitor thread.
3. On freeze / heartbeat / recovery — emit native JSON logs and queue JS events.
4. App calls `watchdog.stop()` — stop timer, join monitor thread, clear bridge.

## Core Runtime Components (v1)

### 1) JS API Layer

Responsibilities:

- parse and validate config;
- expose `start()`, `stop()`, event subscriptions;
- drive the event-loop progress marker via periodic `kick()`;
- map native events into JS-friendly payloads.

### 2) Native Watchdog Engine (N-API)

Responsibilities:

- maintain timing state;
- run watchdog monitor thread;
- schedule event-loop-safe callbacks;
- emit structured events for logging/event bridge.

Design principles:

- no HandleScope / JS execution from the watchdog monitor thread;
- `RequestInterrupt` from the monitor is allowed (thread-safe); stack walk runs on the isolate thread;
- thread-safe state via atomics/minimal locking;
- deterministic start/stop lifecycle.

### 3) Logger Subsystem

Responsibilities:

- JSON Lines output;
- sinks: `stderr`, `file`, or `both`;
- best-effort writes with fallback behavior.

Event classes:

- `freeze_started`
- `freeze_heartbeat`
- `freeze_recovered`
- `freeze_stack` (optional; when `captureStack` is enabled)

### 4) Stack capture (opt-in)

When `captureStack` is enabled, the monitor thread calls V8 `RequestInterrupt`.
The interrupt callback runs on the isolate thread, captures `v8::StackTrace`,
and only stashes frames (+ queues a pending event). The monitor thread then
writes `freeze_stack` / notifies JS — never logger or N-API from the interrupt.

- Default sampling: on `freeze_started` only (`on: "started"`).
- `"both"` / `"heartbeat"` re-sample on heartbeats.
- Sync I/O / native blocks may never reach a safepoint → `stack_status: "unavailable"` (no `stack` field).
- `freeze_stack` reuses `rss_mb` / `cpu_pct` from the latest lifecycle event so a near-zero-delta CPU sample is not emitted.
- Implemented in-core (experimental); not a separate package.

## Freeze Detection Model

Conceptual state machine:

- **Healthy**: heartbeat/tick observed in expected window.
- **Frozen**: threshold exceeded; emit `freeze_started` once.
- **Frozen+Heartbeat**: emit periodic `freeze_heartbeat`.
- **Recovered**: event loop responds again; emit `freeze_recovered` with duration.

Suggested inputs:

- monotonic clock timestamps;
- event-loop progress marker (heartbeat/tick signal);
- process stats sampler.

## Threading Model

- **Event loop thread**
  - owns JS runtime;
  - receives safe callbacks/dispatches events.
- **Watchdog monitor thread**
  - checks elapsed time;
  - controls freeze state transitions;
  - samples RSS/CPU when emitting lifecycle events;
  - may call thread-safe `Isolate::RequestInterrupt` (no HandleScope / JS from this thread).
  - stack formatting runs later on the isolate thread inside the interrupt callback.

## Data Model for Events

Required fields:

- `ts`
- `event`
- `pid`
- `duration_ms` (when meaningful)
- `freeze_id` (correlate start/heartbeat/recovery/stack)

Recommended fields:

- `rss_mb`
- `cpu_pct`
- `threshold_ms`
- `heartbeat_ms`
- `sequence`

Optional (experimental, when `captureStack` is enabled):

- `stack_status` — `"ok"` \| `"unavailable"`
- `stack_mode` — `"interrupt"`
- `stack` — string frames; present only when `stack_status` is `"ok"`

## Error Handling and Safety

- Logger I/O is best-effort (for example a missing parent directory fails open without crashing).
- Invalid config fails fast at `start()` in the JS layer.
- `stop()` is idempotent; the native destructor also stops the monitor thread on addon unload.

## Packaging Architecture

Main package:

- `@js-ak/watchdog` (core detector + optional stack capture)

Binary selection:

- load matching ABI-tagged prebuild `.node` by `platform/arch` + `NODE_MODULE_VERSION`.
- Stack capture uses V8 C++ APIs; release CI ships one ABI binary per supported Node major.
  Other Node majors may need a local `npm rebuild`.

## CI/CD

Current path:

- `master` is the release branch (semantic-release + npm publish);
- `dev` is configured in `.releaserc.js` as an optional prerelease channel when that branch exists;
- release workflow builds ABI-tagged prebuilds per platform/arch × Node major, then publishes one versioned package;
- CI rebuilds the addon and runs unit/integration + smoke load tests.

## Security and Operational Notes

- Do not expose sensitive process data by default (`captureStack` is off).
- When stack capture is enabled, frames often include absolute file paths — treat logs as sensitive.
- Log format must be stable and parseable for the stable field set; experimental stack fields may evolve.
- File logging is append-only; rotation is left to the host (logrotate, etc.).
- Keep diagnostics features opt-in if they increase risk or overhead.
