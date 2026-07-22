#include <node_api.h>

#include <memory>
#include <string>

#include "watchdog.h"

namespace {

struct AddonState {
  std::unique_ptr<jsak::watchdog::Watchdog> watchdog;
  napi_threadsafe_function tsfn = nullptr;
  napi_ref js_callback_ref = nullptr;
};

struct TsfnEvent {
  jsak::watchdog::Event event;
};

AddonState* GetState(napi_env env) {
  AddonState* state = nullptr;
  napi_get_instance_data(env, reinterpret_cast<void**>(&state));
  return state;
}

void CallJs(napi_env env, napi_value js_callback, void* /*context*/,
            void* data) {
  auto* payload = static_cast<TsfnEvent*>(data);
  if (env == nullptr || js_callback == nullptr) {
    delete payload;
    return;
  }

  const jsak::watchdog::Event& event = payload->event;

  napi_value object;
  napi_create_object(env, &object);

  const char* type_name = "freeze_started";
  const char* event_name = "freeze";
  switch (event.type) {
    case jsak::watchdog::EventType::FreezeStarted:
      type_name = "freeze_started";
      event_name = "freeze";
      break;
    case jsak::watchdog::EventType::FreezeHeartbeat:
      type_name = "freeze_heartbeat";
      event_name = "freeze";
      break;
    case jsak::watchdog::EventType::FreezeRecovered:
      type_name = "freeze_recovered";
      event_name = "recovered";
      break;
  }

  napi_value event_type;
  napi_create_string_utf8(env, type_name, NAPI_AUTO_LENGTH, &event_type);
  napi_set_named_property(env, object, "event", event_type);

  napi_value channel;
  napi_create_string_utf8(env, event_name, NAPI_AUTO_LENGTH, &channel);
  napi_set_named_property(env, object, "channel", channel);

  // Number fields match the public JS/JSON contract (safe for typical freeze durations).
  napi_value freeze_id;
  napi_create_double(env, static_cast<double>(event.freeze_id), &freeze_id);
  napi_set_named_property(env, object, "freeze_id", freeze_id);

  napi_value duration_ms;
  napi_create_double(env, static_cast<double>(event.duration_ms), &duration_ms);
  napi_set_named_property(env, object, "duration_ms", duration_ms);

  napi_value threshold_ms;
  napi_create_uint32(env, event.threshold_ms, &threshold_ms);
  napi_set_named_property(env, object, "threshold_ms", threshold_ms);

  napi_value heartbeat_ms;
  napi_create_uint32(env, event.heartbeat_ms, &heartbeat_ms);
  napi_set_named_property(env, object, "heartbeat_ms", heartbeat_ms);

  napi_value sequence;
  napi_create_uint32(env, event.sequence, &sequence);
  napi_set_named_property(env, object, "sequence", sequence);

  napi_value pid;
  napi_create_uint32(env, event.pid, &pid);
  napi_set_named_property(env, object, "pid", pid);

  napi_value rss_mb;
  napi_create_double(env, event.rss_mb, &rss_mb);
  napi_set_named_property(env, object, "rss_mb", rss_mb);

  napi_value cpu_pct;
  napi_create_double(env, event.cpu_pct, &cpu_pct);
  napi_set_named_property(env, object, "cpu_pct", cpu_pct);

  napi_value undefined;
  napi_get_undefined(env, &undefined);
  napi_call_function(env, undefined, js_callback, 1, &object, nullptr);

  delete payload;
}

void ReleaseTsfn(AddonState* state) {
  if (state->tsfn != nullptr) {
    napi_release_threadsafe_function(state->tsfn, napi_tsfn_abort);
    state->tsfn = nullptr;
  }
}

void ClearEventBridge(AddonState* state) {
  if (state->watchdog) {
    state->watchdog->SetEventCallback(nullptr);
  }
  ReleaseTsfn(state);
}

void FinalizeState(napi_env env, void* data, void* /*hint*/) {
  auto* state = static_cast<AddonState*>(data);
  if (state->watchdog) {
    state->watchdog->Stop();
    state->watchdog.reset();
  }
  ClearEventBridge(state);
  if (state->js_callback_ref != nullptr && env != nullptr) {
    napi_delete_reference(env, state->js_callback_ref);
    state->js_callback_ref = nullptr;
  }
  delete state;
}

napi_status EnsureTsfn(napi_env env, AddonState* state, napi_value js_callback) {
  if (state->tsfn != nullptr) {
    return napi_ok;
  }

  napi_value async_resource_name;
  napi_create_string_utf8(env, "watchdog:event", NAPI_AUTO_LENGTH,
                          &async_resource_name);

  napi_value resource_object;
  napi_create_object(env, &resource_object);

  const napi_status status = napi_create_threadsafe_function(
      env, js_callback, resource_object, async_resource_name, 0, 1, nullptr,
      nullptr, nullptr, CallJs, &state->tsfn);
  if (status != napi_ok) {
    return status;
  }

  // Do not keep the event loop alive solely because of the watchdog bridge.
  return napi_unref_threadsafe_function(env, state->tsfn);
}

void NativeEmit(AddonState* state, const jsak::watchdog::Event& event) {
  if (state->tsfn == nullptr) {
    return;
  }

  auto* payload = new TsfnEvent{event};
  const napi_status status = napi_call_threadsafe_function(
      state->tsfn, payload, napi_tsfn_nonblocking);
  if (status != napi_ok) {
    delete payload;
  }
}

napi_value Start(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);

  jsak::watchdog::Config config;

  if (argc >= 1) {
    napi_valuetype type;
    napi_typeof(env, argv[0], &type);
    if (type == napi_object) {
      napi_value value;

      if (napi_get_named_property(env, argv[0], "freezeThresholdMs", &value) ==
          napi_ok) {
        uint32_t n = 0;
        if (napi_get_value_uint32(env, value, &n) == napi_ok && n > 0) {
          config.freeze_threshold_ms = n;
        }
      }

      if (napi_get_named_property(env, argv[0], "heartbeatMs", &value) ==
          napi_ok) {
        uint32_t n = 0;
        if (napi_get_value_uint32(env, value, &n) == napi_ok && n > 0) {
          config.heartbeat_ms = n;
        }
      }

      if (napi_get_named_property(env, argv[0], "logTarget", &value) ==
          napi_ok) {
        size_t len = 0;
        napi_get_value_string_utf8(env, value, nullptr, 0, &len);
        std::string target(len, '\0');
        if (napi_get_value_string_utf8(env, value, target.data(), len + 1,
                                       &len) == napi_ok) {
          if (target == "stderr") {
            config.log_target = jsak::watchdog::LogTarget::Stderr;
          } else if (target == "file") {
            config.log_target = jsak::watchdog::LogTarget::File;
          } else if (target == "both") {
            config.log_target = jsak::watchdog::LogTarget::Both;
          }
        }
      }

      if (napi_get_named_property(env, argv[0], "logFile", &value) == napi_ok) {
        size_t len = 0;
        napi_get_value_string_utf8(env, value, nullptr, 0, &len);
        std::string path(len, '\0');
        if (napi_get_value_string_utf8(env, value, path.data(), len + 1,
                                       &len) == napi_ok &&
            !path.empty()) {
          config.log_file = path;
        }
      }
    }
  }

  AddonState* state = GetState(env);
  if (!state->watchdog) {
    state->watchdog = std::make_unique<jsak::watchdog::Watchdog>();
  }

  if (argc >= 2) {
    napi_valuetype cb_type;
    napi_typeof(env, argv[1], &cb_type);
    if (cb_type == napi_function) {
      if (state->js_callback_ref != nullptr) {
        napi_delete_reference(env, state->js_callback_ref);
        state->js_callback_ref = nullptr;
      }
      napi_create_reference(env, argv[1], 1, &state->js_callback_ref);

      ReleaseTsfn(state);
      if (EnsureTsfn(env, state, argv[1]) != napi_ok) {
        napi_throw_error(env, nullptr, "failed to create threadsafe function");
        napi_value result;
        napi_get_boolean(env, false, &result);
        return result;
      }

      state->watchdog->SetEventCallback(
          [state](const jsak::watchdog::Event& event) {
            NativeEmit(state, event);
          });
    }
  }

  const bool started = state->watchdog->Start(config);

  napi_value result;
  napi_get_boolean(env, started, &result);
  return result;
}

napi_value Stop(napi_env env, napi_callback_info /*info*/) {
  AddonState* state = GetState(env);
  if (state->watchdog) {
    state->watchdog->Stop();
  }
  ClearEventBridge(state);

  if (state->js_callback_ref != nullptr) {
    napi_delete_reference(env, state->js_callback_ref);
    state->js_callback_ref = nullptr;
  }

  napi_value undefined;
  napi_get_undefined(env, &undefined);
  return undefined;
}

napi_value Kick(napi_env env, napi_callback_info /*info*/) {
  AddonState* state = GetState(env);
  if (state->watchdog) {
    state->watchdog->Kick();
  }

  napi_value undefined;
  napi_get_undefined(env, &undefined);
  return undefined;
}

napi_value IsRunning(napi_env env, napi_callback_info /*info*/) {
  AddonState* state = GetState(env);
  const bool running = state->watchdog && state->watchdog->IsRunning();

  napi_value result;
  napi_get_boolean(env, running, &result);
  return result;
}

napi_value Init(napi_env env, napi_value exports) {
  auto* state = new AddonState();
  napi_set_instance_data(env, state, FinalizeState, nullptr);

  napi_property_descriptor props[] = {
      {"start", nullptr, Start, nullptr, nullptr, nullptr, napi_default,
       nullptr},
      {"stop", nullptr, Stop, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"kick", nullptr, Kick, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"isRunning", nullptr, IsRunning, nullptr, nullptr, nullptr, napi_default,
       nullptr},
  };

  napi_define_properties(env, exports, sizeof(props) / sizeof(props[0]), props);
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
