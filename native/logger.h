#pragma once

#include <mutex>
#include <string>

#include "watchdog.h"

namespace jsak {
namespace watchdog {

struct LoggerConfig {
  LogTarget target = LogTarget::Stderr;
  std::string file_path = "./watchdog.log";
};

class Logger {
 public:
  Logger() = default;

  void Configure(const LoggerConfig& config);
  void LogEvent(const Event& event);

 private:
  void WriteLine(const std::string& line);

  LoggerConfig config_{};
  std::mutex mutex_;
};

}  // namespace watchdog
}  // namespace jsak
