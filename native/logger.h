#pragma once

#include <fstream>
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
  ~Logger();

  Logger(const Logger&) = delete;
  Logger& operator=(const Logger&) = delete;

  void Configure(const LoggerConfig& config);
  void LogEvent(const Event& event);

 private:
  void WriteLine(const std::string& line);
  void CloseFile();
  void EnsureFileOpen();

  LoggerConfig config_{};
  std::mutex mutex_;
  std::ofstream file_;
};

}  // namespace watchdog
}  // namespace jsak
