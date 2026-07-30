#pragma once

#include <algorithm>
#include <string>
#include <vector>

#include <v8-profiler.h>
#include <v8.h>

#include "watchdog.h"

namespace jsak {
namespace watchdog {
namespace {

inline constexpr const char kCpuProfileTitle[] = "js-ak/watchdog";

inline std::string FormatProfileFrame(v8::Isolate* isolate,
                                      const v8::CpuProfileNode* node) {
  if (node == nullptr) {
    return "at <unknown>";
  }

  v8::String::Utf8Value fn(isolate, node->GetFunctionName());
  v8::String::Utf8Value script(isolate, node->GetScriptResourceName());
  const int line = node->GetLineNumber();
  const int column = node->GetColumnNumber();

  std::string out = "at ";
  if (fn.length() > 0) {
    out.append(*fn, static_cast<size_t>(fn.length()));
    out += " (";
  }

  if (script.length() > 0) {
    out.append(*script, static_cast<size_t>(script.length()));
  } else {
    out += "<anonymous>";
  }
  if (line > 0) {
    out += ':';
    out += std::to_string(line);
    if (column > 0) {
      out += ':';
      out += std::to_string(column);
    }
  }

  if (fn.length() > 0) {
    out += ')';
  }
  return out;
}

inline void WalkProfileNode(v8::Isolate* isolate,
                            const v8::CpuProfileNode* node,
                            std::vector<std::string>& path,
                            std::vector<StackSample>& samples,
                            int max_frames) {
  if (node == nullptr) {
    return;
  }

  path.push_back(FormatProfileFrame(isolate, node));

  const unsigned hits = node->GetHitCount();
  if (hits > 0 && path.size() > 1) {
    // Skip pure root-only hits; keep paths with real frames.
    StackSample sample;
    sample.count = hits;
    // Leaf-first order to match interrupt / Error.stack style.
    const size_t n = path.size();
    const size_t take =
        max_frames > 0 ? std::min(n, static_cast<size_t>(max_frames)) : n;
    sample.stack.reserve(take);
    for (size_t i = 0; i < take; i += 1) {
      sample.stack.push_back(path[n - 1 - i]);
    }
    samples.push_back(std::move(sample));
  }

  const int children = node->GetChildrenCount();
  for (int i = 0; i < children; i += 1) {
    WalkProfileNode(isolate, node->GetChild(i), path, samples, max_frames);
  }

  path.pop_back();
}

}  // namespace

inline std::vector<StackSample> CollectCpuProfileSamples(
    v8::Isolate* isolate, const v8::CpuProfile* profile, int max_frames,
    uint32_t max_samples) {
  std::vector<StackSample> samples;
  if (isolate == nullptr || profile == nullptr) {
    return samples;
  }

  std::vector<std::string> path;
  WalkProfileNode(isolate, profile->GetTopDownRoot(), path, samples,
                  max_frames);

  std::stable_sort(samples.begin(), samples.end(),
                   [](const StackSample& a, const StackSample& b) {
                     return a.count > b.count;
                   });

  const uint32_t cap = ClampStackSamples(max_samples);
  if (samples.size() > static_cast<size_t>(cap)) {
    samples.resize(static_cast<size_t>(cap));
  }
  return samples;
}

inline bool StartCpuProfiling(v8::Isolate* isolate,
                              v8::CpuProfiler** profiler) {
  if (isolate == nullptr || profiler == nullptr) {
    return false;
  }
  if (*profiler == nullptr) {
    *profiler = v8::CpuProfiler::New(isolate);
  }
  if (*profiler == nullptr) {
    return false;
  }

  v8::HandleScope handle_scope(isolate);
  v8::Local<v8::String> title =
      v8::String::NewFromUtf8(isolate, kCpuProfileTitle,
                              v8::NewStringType::kNormal)
          .ToLocalChecked();
  (*profiler)->StartProfiling(title, true);
  return true;
}

inline v8::CpuProfile* StopCpuProfiling(v8::Isolate* isolate,
                                        v8::CpuProfiler* profiler) {
  if (isolate == nullptr || profiler == nullptr) {
    return nullptr;
  }
  v8::HandleScope handle_scope(isolate);
  v8::Local<v8::String> title =
      v8::String::NewFromUtf8(isolate, kCpuProfileTitle,
                              v8::NewStringType::kNormal)
          .ToLocalChecked();
  return profiler->StopProfiling(title);
}

inline void DisposeCpuProfiler(v8::CpuProfiler** profiler) {
  if (profiler == nullptr || *profiler == nullptr) {
    return;
  }
  (*profiler)->Dispose();
  *profiler = nullptr;
}

}  // namespace watchdog
}  // namespace jsak
