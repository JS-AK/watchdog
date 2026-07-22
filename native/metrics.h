#pragma once

#include <cstdint>

namespace jsak {
namespace watchdog {

struct ProcessMetrics {
  uint32_t pid = 0;
  double rss_mb = 0.0;
  double cpu_pct = -1.0;  // -1 means unavailable
};

uint32_t CurrentPid();
double CurrentRssMb();

// Best-effort process CPU % since previous sample.
// Pass previous wall/cpu times; updates them in-place.
double SampleCpuPercent(uint64_t* prev_wall_ms, uint64_t* prev_cpu_ms);

ProcessMetrics SampleMetrics(uint64_t* prev_wall_ms, uint64_t* prev_cpu_ms);

}  // namespace watchdog
}  // namespace jsak
