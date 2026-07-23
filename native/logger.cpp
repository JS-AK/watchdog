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
    file_.flush();
    file_.close();
  }
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

void Logger::WriteLine(const std::string& line) {
  const bool to_stderr = config_.target == LogTarget::Stderr ||
                         config_.target == LogTarget::Both;
  const bool to_file =
      config_.target == LogTarget::File || config_.target == LogTarget::Both;

  if (to_stderr) {
    std::fputs(line.c_str(), stderr);
    std::fputc('\n', stderr);
    std::fflush(stderr);
  }

  if (to_file) {
    EnsureFileOpen();
    if (file_) {
      file_ << line << '\n';
      file_.flush();
    }
  }
}

void Logger::LogEvent(const Event& event) {
  std::ostringstream json;
  json << std::fixed << std::setprecision(2);
  json << '{'
       << "\"ts\":\"" << EscapeJson(Iso8601Now()) << "\","
       << "\"event\":\"" << EventName(event.type) << "\","
       << "\"pid\":" << event.pid << ','
       << "\"freeze_id\":" << event.freeze_id << ','
       << "\"duration_ms\":" << event.duration_ms << ','
       << "\"rss_mb\":" << event.rss_mb << ','
       << "\"cpu_pct\":" << event.cpu_pct << ','
       << "\"threshold_ms\":" << event.threshold_ms << ','
       << "\"heartbeat_ms\":" << event.heartbeat_ms << ','
       << "\"sequence\":" << event.sequence;

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
  }

  json << '}';

  std::lock_guard<std::mutex> lock(mutex_);
  WriteLine(json.str());
}

}  // namespace watchdog
}  // namespace jsak
