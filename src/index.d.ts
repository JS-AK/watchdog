declare namespace watchdog {
  export type CaptureStackOn = "started" | "heartbeat" | "both";
  export type CaptureStackMode = "interrupt" | "profile";

  export interface CaptureStackConfig {
    /**
     * Capture strategy. Default: "interrupt".
     * "profile" uses V8 CpuProfiler over the stall (early-arm at threshold/2).
     */
    mode?: CaptureStackMode;
    /**
     * When to request interrupt stack samples. Default: "both".
     * Ignored when `mode` is `"profile"`.
     */
    on?: CaptureStackOn;
    /** Max JS frames to capture / path depth. Default: 50. Range: 1..256. */
    maxFrames?: number;
    /**
     * Max unique stacks (interrupt) or top hot paths (profile) on recovered.
     * Default: 8. Range: 1..32.
     */
    maxSamples?: number;
  }

  export interface WatchdogConfig {
    /** Event-loop lag threshold that starts a freeze. Default: 1000. */
    freezeThresholdMs?: number;
    /** Interval for native freeze_heartbeat logs while frozen (not emitted to JS). Default: 1000. */
    heartbeatMs?: number;
    /** Where native JSON Lines are written. Default: "stderr". */
    logTarget?: "stderr" | "file" | "both";
    /** Log file path when logTarget is "file" or "both". */
    logFile?: string;
    /**
     * Soft size cap (bytes) for the active log file. Default: 10 MiB.
     * When a write would exceed the cap, the file is renamed to `<logFile>.1`
     * (one backup) and a new file is opened. `0` disables in-process rotation.
     * Range: 0..1073741824 (1 GiB). Host logrotate remains fine.
     */
    logMaxBytes?: number;
    /**
     * Optional app/service label for monitoring (not library identity).
     * When set, included as `source` on native JSON Lines and JS events.
     * Max length: 256. Library identity is always `lib: "js-ak/watchdog"`.
     */
    source?: string;
    /**
     * Opt-in JS stack capture via V8 interrupt (unstable).
     * `true` enables defaults; `false`/omit disables.
     */
    captureStack?: boolean | CaptureStackConfig;
  }

  export type WatchdogEventName = "freeze" | "recovered" | "event";

  export type WatchdogEventKind =
    | "freeze_started"
    | "freeze_recovered"
    | "freeze_stack";
  /** Present in native JSON Lines only; not delivered on JS event channels. */
  export type WatchdogNativeLogKind = WatchdogEventKind | "freeze_heartbeat";

  export type StackStatus = "ok" | "unavailable";

  export interface StackSample {
    /**
     * Interrupt: how many samples matched this stack.
     * Profile: V8 CpuProfileNode hit count for this path.
     */
    count: number;
    /** Captured JS frames (`at ...`). */
    stack: string[];
  }

  export interface WatchdogEvent {
    /**
     * ISO-8601 UTC timestamp when the JS payload was built on the event loop.
     * Native JSON Lines use sample time and may differ for the same freeze.
     */
    ts: string;
    /** Fixed library identity (`"js-ak/watchdog"`). */
    lib: "js-ak/watchdog";
    /** App/service label from `start({ source })`; omitted when not configured. */
    source?: string;
    /** Process id that emitted the event. */
    pid: number;
    /** Freeze lifecycle kind. */
    event: WatchdogEventKind;
    /** Correlates started / heartbeat / recovered / stack for one freeze episode. */
    freeze_id: number;
    /** Observed freeze duration in milliseconds. */
    duration_ms: number;
    /** Configured freeze threshold in milliseconds. */
    threshold_ms: number;
    /** Configured heartbeat interval in milliseconds. */
    heartbeat_ms: number;
    /** Heartbeat counter within the current freeze (`0` on started / started-stack). */
    sequence: number;
    /** Resident set size in megabytes at sample time. */
    rss_mb: number;
    /** Process CPU percent since previous sample; may be `-1` if unavailable. */
    cpu_pct: number;
    /** Present when stack capture is enabled for this event. */
    stack_status?: StackStatus;
    /** Capture mode used for this stack / profile sample. */
    stack_mode?: CaptureStackMode;
    /**
     * Captured JS frames (`at ...`); omitted when `stack_status` is not `"ok"`.
     * On `freeze_recovered`, the most frequent interrupt sample or hottest profile path.
     */
    stack?: string[];
    /**
     * Unique stacks / hot paths, sorted by `count` descending.
     * Present on `freeze_recovered` when at least one sample succeeded.
     */
    stack_samples?: StackSample[];
  }

  export type NormalizedCaptureStack = false | Readonly<Required<CaptureStackConfig>>;

  export interface NormalizedWatchdogConfig {
    freezeThresholdMs: number;
    heartbeatMs: number;
    logTarget: "stderr" | "file" | "both";
    logFile: string;
    logMaxBytes: number;
    /** Present only when `start({ source })` was set. */
    source?: string;
    captureStack: NormalizedCaptureStack;
  }

  export interface Watchdog {
    readonly DEFAULTS: Readonly<{
      freezeThresholdMs: number;
      heartbeatMs: number;
      logTarget: "stderr" | "file" | "both";
      logFile: string;
      logMaxBytes: number;
      captureStack: false;
    }>;
    start(config?: WatchdogConfig): boolean;
    stop(): void;
    isRunning(): boolean;
    /** Active config while running (`logFile` absolute), otherwise null. */
    getConfig(): Readonly<NormalizedWatchdogConfig> | null;
    on(event: WatchdogEventName, listener: (event: WatchdogEvent) => void): Watchdog;
    once(event: WatchdogEventName, listener: (event: WatchdogEvent) => void): Watchdog;
    off(event: WatchdogEventName, listener: (event: WatchdogEvent) => void): Watchdog;
    removeAllListeners(event?: WatchdogEventName): Watchdog;
  }
}

declare const watchdog: watchdog.Watchdog;
export = watchdog;
