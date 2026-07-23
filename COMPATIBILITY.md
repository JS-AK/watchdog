# Compatibility Policy (v1)

This document defines the stability contract for `@js-ak/watchdog` on the `1.x` line.

## SemVer

- **MAJOR**: breaking API/event/config changes.
- **MINOR**: new optional config fields, new events, additive methods.
- **PATCH**: bug fixes, performance, docs, internals without public contract changes.

## Stable in v1

These are covered by the compatibility promise:

- Methods: `start`, `stop`, `isRunning`, `getConfig`, `on`, `once`, `off`, `removeAllListeners`
- Export: `DEFAULTS` (frozen default config values)
- Config keys: `freezeThresholdMs`, `heartbeatMs`, `logTarget`, `logFile`,
  `logMaxBytes`, `source`
  (`source` optional app/service label; omit to leave the field off payloads;
  `logMaxBytes` soft file-size cap, `0` disables in-process rotation)
- Event channels: `freeze`, `recovered`, `event`
- Event payload fields:
  - `ts`, `lib`, `pid`, `event`, `freeze_id`, `duration_ms`
  - `threshold_ms`, `heartbeat_ms`, `sequence`
  - `rss_mb`, `cpu_pct`
  - `source` (only when `start({ source })` was set)
- Native JSON Lines fields with the same names as above (`event` values:
  `freeze_started`, `freeze_heartbeat`, `freeze_recovered`)
- `lib` is always `"js-ak/watchdog"` (library identity; not configurable)
- JS event bridge does **not** emit `freeze_heartbeat` (native logs only); this avoids
  unbounded TSFN growth while the event loop cannot drain callbacks.

Notes on `ts`:

- Native JSON Lines `ts` is the sample time on the monitor thread.
- JS event `ts` is set when the payload is built on the event loop (after recovery for in-freeze events), so it may differ from the matching log line.

## Explicitly unstable / reserved

- Underscored exports (`_bus`, `_addon`) are internal test hooks and may change or disappear.
- Unknown `start(config)` keys are ignored (only known config keys above / below are applied).
- Opt-in stack capture is experimental and may change shape without a major bump until marked stable:
  - config: `captureStack` (`false` \| `true` \| `{ mode, on, maxFrames }`); default `false`;
  - additive event value `freeze_stack` (same channels as other freeze events);
  - payload fields: `stack_status`, `stack_mode`, `stack` (`stack` only when status is `"ok"`);
  - uses V8 `RequestInterrupt` (JS busy-loop stacks; sync I/O / native blocks may yield `unavailable`);
  - stack frames may include absolute file paths — treat logs as sensitive when enabled;
  - if the loaded native addon ABI (`NODE_MODULE_VERSION`) differs from the
    runtime (no matching published prebuild for this Node major),
    `captureStack` is disabled with a warning.

## Behavioral guarantees

- `start()` is idempotent: returns `false` if already running.
- `stop()` is idempotent and safe to call when not running.
- `stop()` during an active freeze closes the episode with `freeze_recovered`.
- `getConfig().logFile` is the absolute path passed to the native logger.
- Native freeze logs are written from a monitor thread and do not require a live event loop.
- File logging keeps the handle open; `freeze_heartbeat` lines are buffered in the file
  sink (no per-heartbeat flush) while stderr is always flushed. Lifecycle events
  (`started` / `recovered` / `stack`) flush the file. `stop()` / rotate close flushes
  remaining buffered heartbeats.
- When `logMaxBytes` > 0, exceeding the cap renames the active file to `<logFile>.1`
  (one backup) and opens a new file (best-effort; host logrotate still OK).
- JS event listeners run on the event loop, so during a freeze they are queued and delivered after recovery
  (except best-effort work that already ran on the isolate thread, e.g. stack capture logging).

## Breaking-change examples

Any of the following requires a major bump in `1.x`:

- renaming/removing a stable method or config key;
- changing event channel names;
- removing stable payload fields;
- changing units (for example `duration_ms` → seconds).
