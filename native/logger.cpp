#include "logger.h"

#include <chrono>
#include <cstdio>
#include <ctime>
#include <iomanip>
#include <sstream>

namespace jsak {
namespace watchdog {
namespace {

const char* EventName(EventType type) {
  switch (type) {
    case EventType::FreezeStarted:
      return "freeze_started";
    case EventType::FreezeHeartbeat:
      return "freeze_heartbeat";
    case EventType::FreezeRecovered:
      return "freeze_recovered";
    case EventType::FreezeStack:
      return "freeze_stack";
  }
  return "unknown";
}

const char* StackStatusName(StackStatus status) {
  switch (status) {
    case StackStatus::Ok:
      return "ok";
    case StackStatus::Unavailable:
      return "unavailable";
    case StackStatus::None:
      return nullptr;
  }
  return nullptr;
}

std::string Iso8601Now() {
  using namespace std::chrono;
  const auto now = system_clock::now();
  const auto secs = time_point_cast<seconds>(now);
  const auto ms = duration_cast<milliseconds>(now - secs).count();

  std::time_t t = system_clock::to_time_t(now);
  std::tm tm_buf{};
#if defined(_WIN32)
  gmtime_s(&tm_buf, &t);
#else
  gmtime_r(&t, &tm_buf);
#endif

  std::ostringstream out;
  out << std::put_time(&tm_buf, "%Y-%m-%dT%H:%M:%S") << '.'
      << std::setw(3) << std::setfill('0') << ms << 'Z';
  return out.str();
}

std::string EscapeJson(const std::string& input) {
  std::string out;
  out.reserve(input.size() + 8);
  for (unsigned char ch : input) {
    switch (ch) {
      case '\\':
        out += "\\\\";
        break;
      case '"':
        out += "\\\"";
        break;
      case '\b':
        out += "\\b";
        break;
      case '\f':
        out += "\\f";
        break;
      case '\n':
        out += "\\n";
        break;
      case '\r':
        out += "\\r";
        break;
      case '\t':
        out += "\\t";
        break;
      default:
        if (ch < 0x20) {
          constexpr char kHex[] = "0123456789abcdef";
          out += "\\u00";
          out += kHex[(ch >> 4) & 0x0f];
          out += kHex[ch & 0x0f];
        } else {
          out += static_cast<char>(ch);
        }
        break;
    }
  }
  return out;
}

}  // namespace

Logger::~Logger() {
  std::lock_guard<std::mutex> lock(mutex_);
  CloseFile();
}

void Logger::CloseFile() {
  if (file_.is_open()) {
    // Always flush on close so buffered heartbeats land before rename/stop.
    file_.flush();
    file_.close();
  }
  file_bytes_ = 0;
}

void Logger::EnsureFileOpen() {
  const bool want_file =
      config_.target == LogTarget::File || config_.target == LogTarget::Both;
  if (!want_file) {
    CloseFile();
    return;
  }
  if (file_.is_open()) {
    return;
  }
  file_.open(config_.file_path, std::ios::out | std::ios::app);
  if (!file_) {
    file_bytes_ = 0;
    return;
  }
  // Append mode: measure current size so rotation accounts for prior content.
  file_.seekp(0, std::ios::end);
  const auto pos = file_.tellp();
  file_bytes_ = pos < 0 ? 0 : static_cast<uint64_t>(pos);
}

void Logger::MaybeRotateBeforeWrite(uint64_t upcoming_bytes) {
  // Disabled, no handle, or empty file: nothing to rotate. A single oversized
  // line on an empty file is written as-is (cannot usefully split it).
  if (config_.max_bytes == 0 || !file_.is_open() || file_bytes_ == 0) {
    return;
  }
  if (file_bytes_ + upcoming_bytes <= config_.max_bytes) {
    return;
  }

  CloseFile();

  // One backup only: `<logFile>.1`. Drop any previous backup, then promote
  // the active file. Failures are ignored (best-effort logging).
  const std::string backup_path = config_.file_path + ".1";
  std::remove(backup_path.c_str());
  std::rename(config_.file_path.c_str(), backup_path.c_str());

  EnsureFileOpen();
}

void Logger::Configure(const LoggerConfig& config) {
  std::lock_guard<std::mutex> lock(mutex_);
  const bool path_changed = config.file_path != config_.file_path;
  const bool target_changed = config.target != config_.target;
  config_ = config;
  if (path_changed || target_changed || !file_.is_open()) {
    CloseFile();
  }
  EnsureFileOpen();
}

void Logger::WriteLine(const std::string& line, bool flush_file) {
  const bool to_stderr = config_.target == LogTarget::Stderr ||
                         config_.target == LogTarget::Both;
  const bool to_file =
      config_.target == LogTarget::File || config_.target == LogTarget::Both;

  if (to_stderr) {
    // stderr stays line-synced: operators watching the console see heartbeats
    // immediately even when the file sink buffers them.
    std::fputs(line.c_str(), stderr);
    std::fputc('\n', stderr);
    std::fflush(stderr);
  }

  if (to_file) {
    EnsureFileOpen();
    if (file_) {
      // +1 for the trailing newline we append below.
      const uint64_t upcoming = static_cast<uint64_t>(line.size()) + 1ull;
      MaybeRotateBeforeWrite(upcoming);
      if (!file_) {
        return;
      }
      file_ << line << '\n';
      file_bytes_ += upcoming;
      if (flush_file) {
        file_.flush();
      }
    }
  }
}

void Logger::LogEvent(const Event& event) {
  std::ostringstream json;
  json << std::fixed << std::setprecision(2);
  json << '{'
       << "\"ts\":\"" << EscapeJson(Iso8601Now()) << "\","
       << "\"lib\":\"js-ak/watchdog\","
       << "\"event\":\"" << EventName(event.type) << "\","
       << "\"pid\":" << event.pid << ','
       << "\"freeze_id\":" << event.freeze_id << ','
       << "\"duration_ms\":" << event.duration_ms << ','
       << "\"rss_mb\":" << event.rss_mb << ','
       << "\"cpu_pct\":" << event.cpu_pct << ','
       << "\"threshold_ms\":" << event.threshold_ms << ','
       << "\"heartbeat_ms\":" << event.heartbeat_ms << ','
       << "\"sequence\":" << event.sequence;

  if (!event.source.empty()) {
    json << ",\"source\":\"" << EscapeJson(event.source) << '"';
  }

  const char* stack_status = StackStatusName(event.stack_status);
  if (stack_status != nullptr) {
    json << ",\"stack_status\":\"" << stack_status << '"';
    if (!event.stack_mode.empty()) {
      json << ",\"stack_mode\":\"" << EscapeJson(event.stack_mode) << '"';
    }
    if (!event.stack.empty()) {
      json << ",\"stack\":[";
      for (size_t i = 0; i < event.stack.size(); i += 1) {
        if (i > 0) {
          json << ',';
        }
        json << '"' << EscapeJson(event.stack[i]) << '"';
      }
      json << ']';
    }
    if (!event.stack_samples.empty()) {
      json << ",\"stack_samples\":[";
      for (size_t i = 0; i < event.stack_samples.size(); i += 1) {
        if (i > 0) {
          json << ',';
        }
        const StackSample& sample = event.stack_samples[i];
        json << "{\"count\":" << sample.count << ",\"stack\":[";
        for (size_t j = 0; j < sample.stack.size(); j += 1) {
          if (j > 0) {
            json << ',';
          }
          json << '"' << EscapeJson(sample.stack[j]) << '"';
        }
        json << "]}";
      }
      json << ']';
    }
  }

  json << '}';

  // Heartbeats are frequent during a long freeze; skip file flush so the
  // monitor thread is not stalled on disk I/O under mutex_. Lifecycle events
  // (started / recovered / stack) still flush so those lines are durable.
  const bool flush_file = event.type != EventType::FreezeHeartbeat;

  std::lock_guard<std::mutex> lock(mutex_);
  WriteLine(json.str(), flush_file);
}

}  // namespace watchdog
}  // namespace jsak
