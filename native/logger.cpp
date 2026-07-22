#include "logger.h"

#include <chrono>
#include <cstdio>
#include <ctime>
#include <fstream>
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
  }
  return "unknown";
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
  for (char ch : input) {
    switch (ch) {
      case '\\':
        out += "\\\\";
        break;
      case '"':
        out += "\\\"";
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
        out += ch;
        break;
    }
  }
  return out;
}

}  // namespace

void Logger::Configure(const LoggerConfig& config) { config_ = config; }

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
    std::ofstream out(config_.file_path, std::ios::out | std::ios::app);
    if (out) {
      out << line << '\n';
      out.flush();
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
       << "\"sequence\":" << event.sequence << '}';

  std::lock_guard<std::mutex> lock(mutex_);
  WriteLine(json.str());
}

}  // namespace watchdog
}  // namespace jsak
