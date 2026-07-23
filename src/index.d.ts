declare namespace watchdog {
  export type CaptureStackOn = "started" | "heartbeat" | "both";

  export interface CaptureStackConfig {
    /** Capture strategy. Currently only V8 RequestInterrupt. Default: "interrupt". */
    mode?: "interrupt";
    /** When to request a stack sample. Default: "started". */
    on?: CaptureStackOn;
    /** Max JS frames to capture. Default: 50. Range: 1..256. */
    maxFrames?: number;
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

  export interface WatchdogEvent {
    /**
     * ISO-8601 UTC timestamp when the JS payload was built on the event loop.
     * Native JSON Lines use sample time and may differ for the same freeze.
     */
    ts: string;
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
    /** Capture mode used for this stack sample. */
    stack_mode?: "interrupt";
    /** Captured JS frames (`at ...`); omitted when `stack_status` is not `"ok"`. */
    stack?: string[];
  }

  export type NormalizedCaptureStack = false | Readonly<Required<CaptureStackConfig>>;

  export interface NormalizedWatchdogConfig {
    freezeThresholdMs: number;
    heartbeatMs: number;
    logTarget: "stderr" | "file" | "both";
    logFile: string;
    captureStack: NormalizedCaptureStack;
  }

  export interface Watchdog {
    readonly DEFAULTS: Readonly<{
      freezeThresholdMs: number;
      heartbeatMs: number;
      logTarget: "stderr" | "file" | "both";
      logFile: string;
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
