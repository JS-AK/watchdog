#pragma once

#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace v8 {
class Isolate;
class CpuProfiler;
}

namespace jsak {
namespace watchdog {

class Logger;

enum class LogTarget : uint8_t {
  Stderr = 0,
  File = 1,
  Both = 2,
};

enum class StackCaptureOn : uint8_t {
  Started = 0,
  Heartbeat = 1,
  Both = 2,
};

enum class StackCaptureMode : uint8_t {
  Interrupt = 0,
  Profile = 1,
};

enum class InterruptAction : uint8_t {
  CaptureStack = 0,
  ProfileStart = 1,
  ProfileStopDiscard = 2,
  ProfileStopAttach = 3,
  ProfileDispose = 4,
};

struct Config {
  uint32_t freeze_threshold_ms = 1000;
  uint32_t heartbeat_ms = 1000;
  LogTarget log_target = LogTarget::Stderr;
  std::string log_file = "./watchdog.log";
  // Soft cap for the active log file; 0 disables in-process rotation.
  // Default matches JS DEFAULTS (10 MiB) + one `<logFile>.1` backup.
  uint64_t log_max_bytes = 10ull * 1024ull * 1024ull;
  // Optional app/service label; empty means omit `source` from payloads.
  std::string source;
  bool capture_stack = false;
  StackCaptureMode capture_stack_mode = StackCaptureMode::Interrupt;
  StackCaptureOn capture_stack_on = StackCaptureOn::Both;
  uint32_t capture_stack_max_frames = 50;
  uint32_t capture_stack_max_samples = 8;
};

// Matches JS normalizeConfig / CaptureStackConfig range.
inline constexpr uint32_t kMinStackFrames = 1;
inline constexpr uint32_t kMaxStackFrames = 256;
inline constexpr uint32_t kMinStackSamples = 1;
inline constexpr uint32_t kMaxStackSamples = 32;

inline uint32_t ClampStackFrames(uint32_t frames) {
  if (frames < kMinStackFrames) {
    return kMinStackFrames;
  }
  if (frames > kMaxStackFrames) {
    return kMaxStackFrames;
  }
  return frames;
}

inline uint32_t ClampStackSamples(uint32_t samples) {
  if (samples < kMinStackSamples) {
    return kMinStackSamples;
  }
  if (samples > kMaxStackSamples) {
    return kMaxStackSamples;
  }
  return samples;
}

enum class EventType : uint8_t {
  FreezeStarted = 1,
  FreezeHeartbeat = 2,
  FreezeRecovered = 3,
  FreezeStack = 4,
};

enum class StackStatus : uint8_t {
  None = 0,
  Ok = 1,
  Unavailable = 2,
};

struct StackSample {
  uint32_t count = 0;
  std::vector<std::string> stack;
};

struct Event {
  EventType type = EventType::FreezeStarted;
  uint64_t freeze_id = 0;
  uint64_t duration_ms = 0;
  uint32_t threshold_ms = 0;
  uint32_t heartbeat_ms = 0;
  uint32_t sequence = 0;
  uint32_t pid = 0;
  double rss_mb = 0.0;
  double cpu_pct = -1.0;
  // Optional app/service label from Config; empty means omit from payloads.
  std::string source;
  StackStatus stack_status = StackStatus::None;
  std::string stack_mode;
  std::vector<std::string> stack;
  // Aggregated unique stacks / profile hot paths (recovered); empty otherwise.
  std::vector<StackSample> stack_samples;
};

using EventCallback = std::function<void(const Event&)>;

class Watchdog;

struct InterruptGate {
  std::mutex mutex;
  std::condition_variable cv;
  bool open = false;
  Watchdog* watchdog = nullptr;
  // Active interrupt callback bodies that may touch Watchdog without
  // holding mutex (after the open/watchdog check). Stop waits for zero.
  int in_flight = 0;
};

struct StackInterruptPayload {
  std::shared_ptr<InterruptGate> gate;
  InterruptAction action = InterruptAction::CaptureStack;
  uint64_t freeze_id = 0;
  uint64_t generation = 0;
  uint32_t sequence = 0;
  uint32_t max_frames = 50;
};

class Watchdog {
 public:
  Watchdog();
  ~Watchdog();

  Watchdog(const Watchdog&) = delete;
  Watchdog& operator=(const Watchdog&) = delete;

  void SetEventCallback(EventCallback callback);
  void SetIsolate(v8::Isolate* isolate);

  bool Start(const Config& config);
  void Stop();
  bool IsRunning() const;

  // Called from the event loop thread to mark progress.
  void Kick();

  // Called from V8 interrupt on the isolate thread.
  void OnInterrupt(v8::Isolate* isolate, InterruptAction action,
                    uint64_t freeze_id, uint64_t generation, uint32_t sequence,
                    uint32_t max_frames);

 private:
  void MonitorLoop();
  void Emit(Event event);
  void RequestInterruptAction(InterruptAction action, uint64_t freeze_id,
                              uint32_t sequence);
  bool WaitInterruptAction(uint32_t timeout_ms);
  void SignalInterruptActionDone();
  void DisableInterrupts();
  bool IsProfileMode() const;
  bool ShouldCaptureOnStarted() const;
  bool ShouldCaptureOnHeartbeat() const;
  uint32_t ProfileArmMs() const;
  void AttachRecoveredStack(Event* event, uint64_t freeze_id);
  void FinalizeProfileForRecovered(uint64_t freeze_id);
  // Publishes a freeze_stack queued by the V8 interrupt (monitor thread only).
  void DrainPendingStackEvent();
  // Insert/increment a unique stack sample for the active freeze (caller holds
  // stack_mutex_). Caps unique entries at capture_stack_max_samples.
  void RecordStackSampleLocked(uint64_t freeze_id,
                               const std::vector<std::string>& frames);
  void ClearStackAggregationLocked();
  void ApplyProfileSamplesLocked(uint64_t freeze_id,
                                 std::vector<StackSample> samples);

  Config config_{};
  EventCallback on_event_;
  std::mutex on_event_mutex_;
  std::unique_ptr<Logger> logger_;
  std::atomic<bool> running_{false};
  std::atomic<uint64_t> last_kick_ms_{0};
  uint64_t prev_wall_ms_ = 0;
  uint64_t prev_cpu_ms_ = 0;
  // Last metrics from lifecycle events; reused by freeze_stack to avoid
  // near-zero-delta CPU samples from the isolate-thread interrupt.
  std::mutex metrics_cache_mutex_;
  uint32_t last_pid_ = 0;
  double last_rss_mb_ = 0.0;
  double last_cpu_pct_ = -1.0;
  std::thread monitor_;

  v8::Isolate* isolate_ = nullptr;
  std::shared_ptr<InterruptGate> interrupt_gate_;
  std::atomic<uint64_t> interrupt_generation_{0};
  std::atomic<uint64_t> active_freeze_id_{0};

  std::mutex stack_mutex_;
  uint64_t stacked_freeze_id_ = 0;
  StackStatus stacked_status_ = StackStatus::None;
  std::vector<std::string> stacked_frames_;
  std::vector<StackSample> stacked_samples_;
  std::string stacked_mode_;

  // Set on isolate thread inside RequestInterrupt; drained on monitor thread.
  // Never call N-API / TSFN / logger from the interrupt callback.
  std::mutex pending_stack_mutex_;
  bool pending_stack_ready_ = false;
  Event pending_stack_event_;

  // CpuProfiler (profile mode). Touched only on isolate thread except atomics.
  v8::CpuProfiler* cpu_profiler_ = nullptr;
  std::atomic<bool> profile_running_{false};
  std::atomic<bool> profile_start_pending_{false};
  std::mutex profile_op_mutex_;
  std::condition_variable profile_op_cv_;
  bool profile_op_done_ = true;
};

}  // namespace watchdog
}  // namespace jsak
