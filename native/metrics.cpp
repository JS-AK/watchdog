#include "metrics.h"

#include <chrono>
#include <cstdlib>

#if defined(_WIN32)
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <psapi.h>
#elif defined(__APPLE__)
#include <mach/mach.h>
#include <sys/resource.h>
#include <unistd.h>
#else
#include <fstream>
#include <string>
#include <sys/resource.h>
#include <unistd.h>
#endif

namespace jsak {
namespace watchdog {
namespace {

uint64_t WallMs() {
  using namespace std::chrono;
  return duration_cast<milliseconds>(steady_clock::now().time_since_epoch())
      .count();
}

#if defined(_WIN32)
uint64_t FileTimeToMs(const FILETIME& ft) {
  ULARGE_INTEGER value;
  value.LowPart = ft.dwLowDateTime;
  value.HighPart = ft.dwHighDateTime;
  // FILETIME is 100-ns intervals.
  return value.QuadPart / 10000ULL;
}

uint64_t CurrentProcessCpuMs() {
  FILETIME creation, exit_time, kernel, user;
  if (!GetProcessTimes(GetCurrentProcess(), &creation, &exit_time, &kernel,
                       &user)) {
    return 0;
  }
  return FileTimeToMs(kernel) + FileTimeToMs(user);
}
#else
uint64_t TimevalToMs(const timeval& tv) {
  return static_cast<uint64_t>(tv.tv_sec) * 1000ULL +
         static_cast<uint64_t>(tv.tv_usec) / 1000ULL;
}

uint64_t CurrentProcessCpuMs() {
  rusage usage;
  if (getrusage(RUSAGE_SELF, &usage) != 0) {
    return 0;
  }
  return TimevalToMs(usage.ru_utime) + TimevalToMs(usage.ru_stime);
}
#endif

}  // namespace

uint32_t CurrentPid() {
#if defined(_WIN32)
  return static_cast<uint32_t>(GetCurrentProcessId());
#else
  return static_cast<uint32_t>(getpid());
#endif
}

double CurrentRssMb() {
#if defined(_WIN32)
  PROCESS_MEMORY_COUNTERS_EX counters;
  if (!GetProcessMemoryInfo(GetCurrentProcess(),
                            reinterpret_cast<PROCESS_MEMORY_COUNTERS*>(&counters),
                            sizeof(counters))) {
    return 0.0;
  }
  return static_cast<double>(counters.WorkingSetSize) / (1024.0 * 1024.0);
#elif defined(__APPLE__)
  task_basic_info_data_t info;
  mach_msg_type_number_t count = TASK_BASIC_INFO_COUNT;
  const kern_return_t kr =
      task_info(mach_task_self(), TASK_BASIC_INFO,
                reinterpret_cast<task_info_t>(&info), &count);
  if (kr != KERN_SUCCESS) {
    return 0.0;
  }
  return static_cast<double>(info.resident_size) / (1024.0 * 1024.0);
#else
  std::ifstream in("/proc/self/statm");
  if (!in) {
    return 0.0;
  }
  unsigned long size_pages = 0;
  unsigned long resident_pages = 0;
  in >> size_pages >> resident_pages;
  const long page_size = sysconf(_SC_PAGESIZE);
  if (page_size <= 0) {
    return 0.0;
  }
  return static_cast<double>(resident_pages) * static_cast<double>(page_size) /
         (1024.0 * 1024.0);
#endif
}

double SampleCpuPercent(uint64_t* prev_wall_ms, uint64_t* prev_cpu_ms) {
  if (prev_wall_ms == nullptr || prev_cpu_ms == nullptr) {
    return -1.0;
  }

  const uint64_t wall = WallMs();
  const uint64_t cpu = CurrentProcessCpuMs();

  double pct = -1.0;
  if (*prev_wall_ms > 0 && wall > *prev_wall_ms) {
    const uint64_t wall_delta = wall - *prev_wall_ms;
    const uint64_t cpu_delta = cpu >= *prev_cpu_ms ? cpu - *prev_cpu_ms : 0;
    pct = (100.0 * static_cast<double>(cpu_delta)) /
          static_cast<double>(wall_delta);
    if (pct < 0.0) {
      pct = 0.0;
    }
    // Cap to a sane upper bound for multi-thread bursts.
    if (pct > 1000.0) {
      pct = 1000.0;
    }
  }

  *prev_wall_ms = wall;
  *prev_cpu_ms = cpu;
  return pct;
}

ProcessMetrics SampleMetrics(uint64_t* prev_wall_ms, uint64_t* prev_cpu_ms) {
  ProcessMetrics metrics;
  metrics.pid = CurrentPid();
  metrics.rss_mb = CurrentRssMb();
  metrics.cpu_pct = SampleCpuPercent(prev_wall_ms, prev_cpu_ms);
  return metrics;
}

}  // namespace watchdog
}  // namespace jsak
