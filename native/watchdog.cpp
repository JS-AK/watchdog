#include "watchdog.h"

#include <algorithm>
#include <chrono>

#include "logger.h"
#include "metrics.h"
#include "stack_capture.h"

namespace jsak {
namespace watchdog {
namespace {

uint64_t NowMs() {
  using namespace std::chrono;
  return duration_cast<milliseconds>(steady_clock::now().time_since_epoch())
      .count();
}

void StackInterruptCallback(v8::Isolate* isolate, void* data) {
  std::unique_ptr<StackInterruptPayload> payload(
      static_cast<StackInterruptPayload*>(data));
  if (!payload || !payload->gate) {
    return;
  }

  const std::shared_ptr<InterruptGate> gate = payload->gate;
  Watchdog* watchdog = nullptr;
  {
    // Pin Watchdog via in_flight so Stop()/DisableInterrupts waits before
    // nulling watchdog — CaptureJsStack must not run under gate->mutex.
    std::lock_guard<std::mutex> lock(gate->mutex);
    if (!gate->open || gate->watchdog == nullptr) {
      return;
    }
    watchdog = gate->watchdog;
    gate->in_flight += 1;
  }

  watchdog->OnStackInterrupt(isolate, payload->freeze_id, payload->generation,
                             payload->sequence, payload->max_frames);

  {
    std::lock_guard<std::mutex> lock(gate->mutex);
    gate->in_flight -= 1;
    gate->cv.notify_all();
  }
}

}  // namespace

Watchdog::Watchdog() : logger_(std::make_unique<Logger>()) {}

Watchdog::~Watchdog() { Stop(); }

void Watchdog::SetEventCallback(EventCallback callback) {
  std::lock_guard<std::mutex> lock(on_event_mutex_);
  on_event_ = std::move(callback);
}

void Watchdog::SetIsolate(v8::Isolate* isolate) { isolate_ = isolate; }

void Watchdog::DisableInterrupts() {
  interrupt_generation_.fetch_add(1, std::memory_order_acq_rel);
  if (!interrupt_gate_) {
    return;
  }

  std::unique_lock<std::mutex> lock(interrupt_gate_->mutex);
  interrupt_gate_->open = false;
  interrupt_gate_->cv.wait(
      lock, [this]() { return interrupt_gate_->in_flight == 0; });
  interrupt_gate_->watchdog = nullptr;
}

bool Watchdog::ShouldCaptureOnStarted() const {
  return config_.capture_stack &&
         (config_.capture_stack_on == StackCaptureOn::Started ||
          config_.capture_stack_on == StackCaptureOn::Both);
}

bool Watchdog::ShouldCaptureOnHeartbeat() const {
  return config_.capture_stack &&
         (config_.capture_stack_on == StackCaptureOn::Heartbeat ||
          config_.capture_stack_on == StackCaptureOn::Both);
}

bool Watchdog::Start(const Config& config) {
  if (running_.exchange(true)) {
    return false;
  }

  config_ = config;
  config_.capture_stack_max_frames =
      ClampStackFrames(config_.capture_stack_max_frames);
  config_.capture_stack_max_samples =
      ClampStackSamples(config_.capture_stack_max_samples);
  logger_->Configure(LoggerConfig{config_.log_target, config_.log_file,
                                  config_.log_max_bytes});
  prev_wall_ms_ = 0;
  prev_cpu_ms_ = 0;
  // Prime CPU sampler so the first freeze event can compute a delta.
  SampleCpuPercent(&prev_wall_ms_, &prev_cpu_ms_);
  last_kick_ms_.store(NowMs(), std::memory_order_release);
  active_freeze_id_.store(0, std::memory_order_release);

  {
    std::lock_guard<std::mutex> lock(metrics_cache_mutex_);
    last_pid_ = 0;
    last_rss_mb_ = 0.0;
    last_cpu_pct_ = -1.0;
  }

  {
    std::lock_guard<std::mutex> lock(stack_mutex_);
    ClearStackAggregationLocked();
  }

  {
    std::lock_guard<std::mutex> lock(pending_stack_mutex_);
    pending_stack_ready_ = false;
    pending_stack_event_ = Event{};
  }

  if (config_.capture_stack && isolate_ != nullptr) {
    interrupt_gate_ = std::make_shared<InterruptGate>();
    std::lock_guard<std::mutex> lock(interrupt_gate_->mutex);
    interrupt_gate_->open = true;
    interrupt_gate_->watchdog = this;
  } else {
    interrupt_gate_.reset();
  }

  monitor_ = std::thread([this]() { MonitorLoop(); });
  return true;
}

void Watchdog::Stop() {
  if (!running_.exchange(false)) {
    return;
  }

  DisableInterrupts();

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

void Watchdog::RequestStackCapture(uint64_t freeze_id, uint32_t sequence) {
  if (!config_.capture_stack || isolate_ == nullptr || !interrupt_gate_) {
    return;
  }

  const uint64_t generation =
      interrupt_generation_.load(std::memory_order_acquire);

  auto* payload = new StackInterruptPayload();
  payload->gate = interrupt_gate_;
  payload->freeze_id = freeze_id;
  payload->generation = generation;
  payload->sequence = sequence;
  payload->max_frames = ClampStackFrames(config_.capture_stack_max_frames);

  isolate_->RequestInterrupt(StackInterruptCallback, payload);
}

void Watchdog::OnStackInterrupt(v8::Isolate* isolate, uint64_t freeze_id,
                                uint64_t generation, uint32_t sequence,
                                uint32_t max_frames) {
  if (generation !=
      interrupt_generation_.load(std::memory_order_acquire)) {
    return;
  }
  if (freeze_id == 0 ||
      freeze_id != active_freeze_id_.load(std::memory_order_acquire)) {
    return;
  }
  if (!running_.load(std::memory_order_acquire)) {
    return;
  }

  // Keep this callback minimal: no logger, no N-API/TSFN, no metrics sample.
  // Emitting via TSFN from a V8 interrupt re-enters Node on the isolate thread
  // and can abort the process (seen with captureStack enabled).
  std::vector<std::string> frames =
      CaptureJsStack(isolate, static_cast<int>(max_frames));
  if (frames.empty()) {
    return;
  }

  {
    std::lock_guard<std::mutex> lock(stack_mutex_);
    RecordStackSampleLocked(freeze_id, frames);
  }

  const uint64_t now = NowMs();
  const uint64_t last = last_kick_ms_.load(std::memory_order_acquire);
  const uint64_t lag = now > last ? now - last : 0;

  Event event;
  event.type = EventType::FreezeStack;
  event.freeze_id = freeze_id;
  event.duration_ms = lag;
  event.threshold_ms = config_.freeze_threshold_ms;
  event.heartbeat_ms = config_.heartbeat_ms;
  event.sequence = sequence;
  event.stack_status = StackStatus::Ok;
  event.stack_mode = "interrupt";
  event.stack = std::move(frames);

  {
    std::lock_guard<std::mutex> lock(pending_stack_mutex_);
    pending_stack_event_ = std::move(event);
    pending_stack_ready_ = true;
  }
}

void Watchdog::ClearStackAggregationLocked() {
  stacked_freeze_id_ = 0;
  stacked_status_ = StackStatus::None;
  stacked_frames_.clear();
  stacked_samples_.clear();
}

void Watchdog::RecordStackSampleLocked(
    uint64_t freeze_id, const std::vector<std::string>& frames) {
  stacked_freeze_id_ = freeze_id;
  stacked_status_ = StackStatus::Ok;
  stacked_frames_ = frames;

  for (StackSample& sample : stacked_samples_) {
    if (sample.stack == frames) {
      sample.count += 1;
      return;
    }
  }

  const uint32_t max_samples =
      ClampStackSamples(config_.capture_stack_max_samples);
  if (stacked_samples_.size() >= static_cast<size_t>(max_samples)) {
    // Cap unique keys: keep counting known stacks, ignore new shapes.
    return;
  }

  StackSample sample;
  sample.count = 1;
  sample.stack = frames;
  stacked_samples_.push_back(std::move(sample));
}

void Watchdog::DrainPendingStackEvent() {
  Event event;
  {
    std::lock_guard<std::mutex> lock(pending_stack_mutex_);
    if (!pending_stack_ready_) {
      return;
    }
    event = std::move(pending_stack_event_);
    pending_stack_ready_ = false;
  }
  Emit(event);
}

void Watchdog::AttachRecoveredStack(Event* event, uint64_t freeze_id) {
  if (!config_.capture_stack || event == nullptr) {
    return;
  }

  event->stack_mode = "interrupt";

  std::lock_guard<std::mutex> lock(stack_mutex_);
  if (stacked_freeze_id_ == freeze_id &&
      stacked_status_ == StackStatus::Ok && !stacked_samples_.empty()) {
    std::vector<StackSample> samples = stacked_samples_;
    std::stable_sort(
        samples.begin(), samples.end(),
        [](const StackSample& a, const StackSample& b) {
          return a.count > b.count;
        });

    event->stack_status = StackStatus::Ok;
    event->stack = samples.front().stack;
    event->stack_samples = std::move(samples);
    return;
  }

  event->stack_status = StackStatus::Unavailable;
  event->stack.clear();
  event->stack_samples.clear();
}

void Watchdog::Emit(Event event) {
  // Stamp optional app label once for native logs and the JS bridge.
  event.source = config_.source;

  if (event.type == EventType::FreezeStack) {
    // Do not call SampleMetrics here: interrupt often lands <1ms after
    // started/heartbeat and would produce cpu_pct 0 / -1 while also
    // poisoning the CPU sampler window for the next lifecycle event.
    std::lock_guard<std::mutex> lock(metrics_cache_mutex_);
    event.pid = last_pid_ != 0 ? last_pid_ : CurrentPid();
    event.rss_mb = last_rss_mb_ > 0.0 ? last_rss_mb_ : CurrentRssMb();
    event.cpu_pct = last_cpu_pct_;
  } else {
    const ProcessMetrics metrics =
        SampleMetrics(&prev_wall_ms_, &prev_cpu_ms_);
    event.pid = metrics.pid;
    event.rss_mb = metrics.rss_mb;
    event.cpu_pct = metrics.cpu_pct;
    {
      std::lock_guard<std::mutex> lock(metrics_cache_mutex_);
      last_pid_ = metrics.pid;
      last_rss_mb_ = metrics.rss_mb;
      last_cpu_pct_ = metrics.cpu_pct;
    }
  }

  logger_->LogEvent(event);

  // Heartbeats stay in native logs only: the JS event loop is frozen, so
  // bridging every heartbeat would grow the TSFN queue without draining.
  if (event.type == EventType::FreezeHeartbeat) {
    return;
  }

  EventCallback callback;
  {
    std::lock_guard<std::mutex> lock(on_event_mutex_);
    callback = on_event_;
  }
  if (callback) {
    callback(event);
  }
}

void Watchdog::MonitorLoop() {
  bool frozen = false;
  uint64_t freeze_began_at_ms = 0;
  uint64_t freeze_id = 0;
  uint64_t last_heartbeat_at_ms = 0;
  uint32_t sequence = 0;

  auto emit = [&](EventType type, uint64_t duration_ms) {
    Event event;
    event.type = type;
    event.freeze_id = freeze_id;
    event.duration_ms = duration_ms;
    event.threshold_ms = config_.freeze_threshold_ms;
    event.heartbeat_ms = config_.heartbeat_ms;
    event.sequence = sequence;
    if (type == EventType::FreezeRecovered) {
      AttachRecoveredStack(&event, freeze_id);
    }
    Emit(event);
  };

  while (running_.load(std::memory_order_acquire)) {
    DrainPendingStackEvent();

    const uint64_t now = NowMs();
    const uint64_t last = last_kick_ms_.load(std::memory_order_acquire);
    const uint64_t lag = now > last ? now - last : 0;

    if (!frozen && lag >= config_.freeze_threshold_ms) {
      frozen = true;
      freeze_began_at_ms = last;
      freeze_id += 1;
      sequence = 0;
      last_heartbeat_at_ms = now;
      active_freeze_id_.store(freeze_id, std::memory_order_release);
      {
        std::lock_guard<std::mutex> lock(stack_mutex_);
        ClearStackAggregationLocked();
        stacked_freeze_id_ = freeze_id;
        stacked_status_ = StackStatus::Unavailable;
      }
      {
        std::lock_guard<std::mutex> lock(pending_stack_mutex_);
        pending_stack_ready_ = false;
        pending_stack_event_ = Event{};
      }
      emit(EventType::FreezeStarted, lag);
      if (ShouldCaptureOnStarted()) {
        RequestStackCapture(freeze_id, sequence);
      }
    } else if (frozen && lag >= config_.freeze_threshold_ms) {
      if (now - last_heartbeat_at_ms >= config_.heartbeat_ms) {
        sequence += 1;
        last_heartbeat_at_ms = now;
        emit(EventType::FreezeHeartbeat, now - freeze_began_at_ms);
        if (ShouldCaptureOnHeartbeat()) {
          RequestStackCapture(freeze_id, sequence);
        }
      }
    } else if (frozen && lag < config_.freeze_threshold_ms) {
      // Flush any stack sample captured just before recovery.
      DrainPendingStackEvent();
      emit(EventType::FreezeRecovered, now - freeze_began_at_ms);
      frozen = false;
      freeze_began_at_ms = 0;
      last_heartbeat_at_ms = 0;
      sequence = 0;
      active_freeze_id_.store(0, std::memory_order_release);
      interrupt_generation_.fetch_add(1, std::memory_order_acq_rel);
    }

    std::this_thread::sleep_for(std::chrono::milliseconds(20));
  }

  DrainPendingStackEvent();

  // Close out an in-flight freeze when stop() interrupts the monitor.
  if (frozen) {
    const uint64_t now = NowMs();
    emit(EventType::FreezeRecovered, now - freeze_began_at_ms);
    active_freeze_id_.store(0, std::memory_order_release);
  }
}

}  // namespace watchdog
}  // namespace jsak
