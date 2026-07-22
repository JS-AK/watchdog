#pragma once

#include <atomic>
#include <cstdint>
#include <functional>
#include <memory>
#include <string>
#include <thread>

namespace jsak {
namespace watchdog {

class Logger;

enum class LogTarget : uint8_t {
  Stderr = 0,
  File = 1,
  Both = 2,
};

struct Config {
  uint32_t freeze_threshold_ms = 1000;
  uint32_t heartbeat_ms = 1000;
  LogTarget log_target = LogTarget::Stderr;
  std::string log_file = "./watchdog.log";
};

enum class EventType : uint8_t {
  FreezeStarted = 1,
  FreezeHeartbeat = 2,
  FreezeRecovered = 3,
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
};

using EventCallback = std::function<void(const Event&)>;

class Watchdog {
 public:
  Watchdog();
  ~Watchdog();

  Watchdog(const Watchdog&) = delete;
  Watchdog& operator=(const Watchdog&) = delete;

  void SetEventCallback(EventCallback callback);

  bool Start(const Config& config);
  void Stop();
  bool IsRunning() const;

  // Called from the event loop thread to mark progress.
  void Kick();

 private:
  void MonitorLoop();
  void Emit(Event event);

  Config config_{};
  EventCallback on_event_;
  std::unique_ptr<Logger> logger_;
  std::atomic<bool> running_{false};
  std::atomic<uint64_t> last_kick_ms_{0};
  uint64_t prev_wall_ms_ = 0;
  uint64_t prev_cpu_ms_ = 0;
  std::thread monitor_;
};

}  // namespace watchdog
}  // namespace jsak
