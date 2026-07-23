#pragma once

#include <cstdint>
#include <fstream>
#include <mutex>
#include <string>

#include "watchdog.h"

namespace jsak {
namespace watchdog {

struct LoggerConfig {
  LogTarget target = LogTarget::Stderr;
  std::string file_path = "./watchdog.log";
  // Soft size cap for the active log file. 0 = no in-process rotation.
  // When a write would exceed the cap: close → rename to `<path>.1` (one
  // backup, previous `.1` discarded) → reopen empty. Host logrotate still OK.
  uint64_t max_bytes = 10ull * 1024ull * 1024ull;
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
  // flush_file: sync the file sink to disk. Heartbeats skip this to avoid
  // blocking the monitor thread on every tick; stderr always fflush'es.
  void WriteLine(const std::string& line, bool flush_file);
  void CloseFile();
  void EnsureFileOpen();
  // Best-effort size rotation under mutex_; never throws.
  void MaybeRotateBeforeWrite(uint64_t upcoming_bytes);

  LoggerConfig config_{};
  std::mutex mutex_;
  std::ofstream file_;
  // Bytes already in the open file (updated on open / write / rotate).
  uint64_t file_bytes_ = 0;
};

}  // namespace watchdog
}  // namespace jsak
