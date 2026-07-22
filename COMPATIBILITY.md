# Compatibility Policy (v1)

This document defines the stability contract for `@js-ak/watchdog` once `1.x` is released.

## SemVer

- **MAJOR**: breaking API/event/config changes.
- **MINOR**: new optional config fields, new events, additive methods.
- **PATCH**: bug fixes, performance, docs, internals without public contract changes.

Until `1.0.0`, the package is `0.x` and the API may still change.

## Stable in v1

These are covered by the compatibility promise:

- Methods: `start`, `stop`, `isRunning`, `getConfig`, `on`, `once`, `off`, `removeAllListeners`
- Config keys: `freezeThresholdMs`, `heartbeatMs`, `logTarget`, `logFile`
- Event channels: `freeze`, `recovered`, `event`
- Event payload fields:
  - `ts`, `pid`, `event`, `freeze_id`, `duration_ms`
  - `threshold_ms`, `heartbeat_ms`, `sequence`
  - `rss_mb`, `cpu_pct`
- Native JSON Lines fields with the same names as above (`event` values:
  `freeze_started`, `freeze_heartbeat`, `freeze_recovered`)

## Explicitly unstable / reserved

- `logLevel` is accepted and validated, but **does not filter output in v1**.
- Underscored exports (`_bus`, `_addon`) are internal test hooks and may change or disappear.
- Optional diagnostics (stack capture, etc.) will ship as separate packages or behind explicit opt-in flags.

## Behavioral guarantees

- `start()` is idempotent: returns `false` if already running.
- `stop()` is idempotent and safe to call when not running.
- Native freeze logs are written from a monitor thread and do not require a live event loop.
- JS event listeners run on the event loop, so during a freeze they are queued and delivered after recovery.

## Breaking-change examples

Any of the following requires a major bump in `1.x`:

- renaming/removing a stable method or config key;
- changing event channel names;
- removing stable payload fields;
- changing units (for example `duration_ms` → seconds).
