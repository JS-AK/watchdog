#include "watchdog.h"

#include <chrono>

#include "logger.h"
#include "metrics.h"

namespace jsak {
namespace watchdog {
namespace {

uint64_t NowMs() {
  using namespace std::chrono;
  return duration_cast<milliseconds>(steady_clock::now().time_since_epoch())
      .count();
}

}  // namespace

Watchdog::Watchdog() : logger_(std::make_unique<Logger>()) {}

Watchdog::~Watchdog() { Stop(); }

void Watchdog::SetEventCallback(EventCallback callback) {
  on_event_ = std::move(callback);
}

bool Watchdog::Start(const Config& config) {
  if (running_.exchange(true)) {
    return false;
  }

  config_ = config;
  logger_->Configure(LoggerConfig{config_.log_target, config_.log_file});
  prev_wall_ms_ = 0;
  prev_cpu_ms_ = 0;
  // Prime CPU sampler so the first freeze event can compute a delta.
  SampleCpuPercent(&prev_wall_ms_, &prev_cpu_ms_);
  last_kick_ms_.store(NowMs(), std::memory_order_release);
  monitor_ = std::thread([this]() { MonitorLoop(); });
  return true;
}

void Watchdog::Stop() {
  if (!running_.exchange(false)) {
    return;
  }

  if (monitor_.joinable()) {
    monitor_.join();
  }
}

bool Watchdog::IsRunning() const {
  return running_.load(std::memory_order_acquire);
}

void Watchdog::Kick() {
  last_kick_ms_.store(NowMs(), std::memory_order_release);
}

void Watchdog::Emit(Event event) {
  const ProcessMetrics metrics =
      SampleMetrics(&prev_wall_ms_, &prev_cpu_ms_);
  event.pid = metrics.pid;
  event.rss_mb = metrics.rss_mb;
  event.cpu_pct = metrics.cpu_pct;

  logger_->LogEvent(event);

  if (on_event_) {
    on_event_(event);
  }
}

void Watchdog::MonitorLoop() {
  bool frozen = false;
  uint64_t freeze_began_at_ms = 0;
  uint64_t freeze_id = 0;
  uint64_t last_heartbeat_at_ms = 0;
  uint32_t sequence = 0;

  while (running_.load(std::memory_order_acquire)) {
    const uint64_t now = NowMs();
    const uint64_t last = last_kick_ms_.load(std::memory_order_acquire);
    const uint64_t lag = now > last ? now - last : 0;

    if (!frozen && lag >= config_.freeze_threshold_ms) {
      frozen = true;
      freeze_began_at_ms = last;
      freeze_id += 1;
      sequence = 0;
      last_heartbeat_at_ms = now;

      Event event;
      event.type = EventType::FreezeStarted;
      event.freeze_id = freeze_id;
      event.duration_ms = lag;
      event.threshold_ms = config_.freeze_threshold_ms;
      event.heartbeat_ms = config_.heartbeat_ms;
      event.sequence = sequence;
      Emit(event);
    } else if (frozen && lag >= config_.freeze_threshold_ms) {
      if (now - last_heartbeat_at_ms >= config_.heartbeat_ms) {
        sequence += 1;
        last_heartbeat_at_ms = now;

        Event event;
        event.type = EventType::FreezeHeartbeat;
        event.freeze_id = freeze_id;
        event.duration_ms = now - freeze_began_at_ms;
        event.threshold_ms = config_.freeze_threshold_ms;
        event.heartbeat_ms = config_.heartbeat_ms;
        event.sequence = sequence;
        Emit(event);
      }
    } else if (frozen && lag < config_.freeze_threshold_ms) {
      Event event;
      event.type = EventType::FreezeRecovered;
      event.freeze_id = freeze_id;
      event.duration_ms = now - freeze_began_at_ms;
      event.threshold_ms = config_.freeze_threshold_ms;
      event.heartbeat_ms = config_.heartbeat_ms;
      event.sequence = sequence;
      Emit(event);

      frozen = false;
      freeze_began_at_ms = 0;
      last_heartbeat_at_ms = 0;
      sequence = 0;
    }

    std::this_thread::sleep_for(std::chrono::milliseconds(20));
  }
}

}  // namespace watchdog
}  // namespace jsak
