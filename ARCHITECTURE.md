# @js-ak/watchdog Architecture

## Overview

The library is an **in-process** N-API addon loaded into the Node.js process.

```text
Node.js process
   │
   ├── require('@js-ak/watchdog')
   │
   ▼
+---------------------------+
| C++ N-API addon           |
|---------------------------|
| Watchdog monitor thread   |
| Event loop tick marker    |
| Logger                    |
| Metrics sampler           |
+---------------------------+
```

Lifecycle:

1. App calls `watchdog.start(config)`.
2. Addon starts monitor thread and event-loop progress marker.
3. On freeze / heartbeat / recovery — emit logs and JS events.
4. App calls `watchdog.stop()` (or process exits) — cleanup.

## Core Runtime Components (v1)

### 1) JS API Layer

Responsibilities:

- parse and validate config;
- expose `start()`, `stop()`, event subscriptions;
- map native events into JS-friendly payloads.

### 2) Native Watchdog Engine (N-API)

Responsibilities:

- maintain timing state;
- run watchdog monitor thread;
- schedule event-loop-safe callbacks;
- emit structured events for logging/event bridge.

Design principles:

- no V8 operations from watchdog thread;
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
- `watchdog_error` (internal non-fatal errors)

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
  - never touches JS/V8 APIs directly.
- **Optional sampler thread (or merged with monitor)**
  - captures RSS/CPU snapshots on schedule.

## Data Model for Events

Required fields:

- `ts`
- `event`
- `pid`
- `duration_ms` (when meaningful)
- `freeze_id` (correlate start/heartbeat/recovery)

Recommended fields:

- `rss_mb`
- `cpu_pct`
- `threshold_ms`
- `heartbeat_ms`
- `sequence`

## Error Handling and Safety

- Native internal errors should be surfaced as logs/events, not hard crashes.
- Invalid config should fail fast at `start()`.
- `stop()` should be idempotent.
- Handle process exit hooks to avoid dangling threads/handles.

## Packaging Architecture

Main package:

- `@js-ak/watchdog`

Binary selection:

- load matching prebuild `.node` by `platform/arch` (+ N-API compatibility).

Possible long-term split:

- `@js-ak/watchdog` (core)
- `@js-ak/watchdog-diagnostics` (experimental stack capture)

## CI/CD Architecture Direction

Recommended path:

- one release version source of truth;
- build matrix for each target platform;
- publish platform artifacts with matching version;
- run smoke tests by loading addon and generating synthetic freeze.

Tooling options:

- semantic-release + CI orchestration,
- or changesets for multi-package growth.

## Security and Operational Notes

- Do not expose sensitive process data by default.
- Log format must be stable and parseable.
- File logging should support rotation strategy (or integrate with external rotation).
- Keep diagnostics features opt-in if they increase risk or overhead.
