#pragma once

#include <string>
#include <vector>

#include <v8.h>

namespace jsak {
namespace watchdog {

inline std::vector<std::string> CaptureJsStack(v8::Isolate* isolate,
                                               int max_frames) {
  std::vector<std::string> frames;
  if (isolate == nullptr || max_frames <= 0) {
    return frames;
  }

  v8::HandleScope handle_scope(isolate);
  v8::Local<v8::StackTrace> trace = v8::StackTrace::CurrentStackTrace(
      isolate, max_frames, v8::StackTrace::kDetailed);
  if (trace.IsEmpty()) {
    return frames;
  }

  const int count = trace->GetFrameCount();
  frames.reserve(static_cast<size_t>(count));

  for (int i = 0; i < count; i += 1) {
    v8::Local<v8::StackFrame> frame = trace->GetFrame(isolate, i);
    if (frame.IsEmpty()) {
      continue;
    }

    v8::String::Utf8Value fn(isolate, frame->GetFunctionName());
    v8::String::Utf8Value script(isolate, frame->GetScriptNameOrSourceURL());
    const int line = frame->GetLineNumber();
    const int column = frame->GetColumn();

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
    out += ':';
    out += std::to_string(line);
    out += ':';
    out += std::to_string(column);

    if (fn.length() > 0) {
      out += ')';
    }

    frames.push_back(std::move(out));
  }

  return frames;
}

}  // namespace watchdog
}  // namespace jsak
