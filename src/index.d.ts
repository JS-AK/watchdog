declare namespace watchdog {
  export interface WatchdogConfig {
    /** Event-loop lag threshold that starts a freeze. Default: 1000. */
    freezeThresholdMs?: number;
    /** Interval between freeze heartbeat events while frozen. Default: 1000. */
    heartbeatMs?: number;
    /** Where native JSON Lines are written. Default: "stderr". */
    logTarget?: "stderr" | "file" | "both";
    /** Log file path when logTarget is "file" or "both". */
    logFile?: string;
  }

  export type WatchdogEventName = "freeze" | "recovered" | "event";

  export type WatchdogEventKind =
    | "freeze_started"
    | "freeze_heartbeat"
    | "freeze_recovered";

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
    /** Correlates started / heartbeat / recovered for one freeze episode. */
    freeze_id: number;
    /** Observed freeze duration in milliseconds. */
    duration_ms: number;
    /** Configured freeze threshold in milliseconds. */
    threshold_ms: number;
    /** Configured heartbeat interval in milliseconds. */
    heartbeat_ms: number;
    /** Heartbeat counter within the current freeze (`0` on started). */
    sequence: number;
    /** Resident set size in megabytes at sample time. */
    rss_mb: number;
    /** Process CPU percent since previous sample; may be `-1` if unavailable. */
    cpu_pct: number;
  }

  export interface Watchdog {
    readonly DEFAULTS: Readonly<Required<WatchdogConfig>>;
    start(config?: WatchdogConfig): boolean;
    stop(): void;
    isRunning(): boolean;
    /** Active config while running (`logFile` absolute), otherwise null. */
    getConfig(): Readonly<Required<WatchdogConfig>> | null;
    on(event: WatchdogEventName, listener: (event: WatchdogEvent) => void): Watchdog;
    once(event: WatchdogEventName, listener: (event: WatchdogEvent) => void): Watchdog;
    off(event: WatchdogEventName, listener: (event: WatchdogEvent) => void): Watchdog;
    removeAllListeners(event?: WatchdogEventName): Watchdog;
  }
}

declare const watchdog: watchdog.Watchdog;
export = watchdog;
