export interface WatchdogConfig {
  /** Event-loop lag threshold that starts a freeze. Default: 1000. */
  freezeThresholdMs?: number;
  /** Interval between freeze heartbeat events while frozen. Default: 1000. */
  heartbeatMs?: number;
  /**
   * Reserved for future log filtering.
   * In v1 all freeze events are always written.
   */
  logLevel?: "debug" | "info" | "warn" | "error";
  /** Where native JSON Lines are written. Default: "stderr". */
  logTarget?: "stderr" | "file" | "both";
  /** Log file path when logTarget is "file" or "both". */
  logFile?: string;
}

export type WatchdogEventName = "freeze" | "recovered" | "event" | "error";

export type WatchdogEventKind =
  | "freeze_started"
  | "freeze_heartbeat"
  | "freeze_recovered";

export interface WatchdogEvent {
  /** ISO-8601 UTC timestamp when the JS payload was built. */
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
  /** Stub marker until native core lands. */
  readonly status: "work in progress";
  start(config?: WatchdogConfig): boolean;
  stop(): void;
  isRunning(): boolean;
  /** Active config while running, otherwise null. */
  getConfig(): Readonly<Required<WatchdogConfig>> | null;
  on(event: WatchdogEventName, listener: (event: WatchdogEvent) => void): Watchdog;
  once(event: WatchdogEventName, listener: (event: WatchdogEvent) => void): Watchdog;
  off(event: WatchdogEventName, listener: (event: WatchdogEvent) => void): Watchdog;
  removeAllListeners(event?: WatchdogEventName): Watchdog;
}

declare const watchdog: Watchdog;
export = watchdog;
