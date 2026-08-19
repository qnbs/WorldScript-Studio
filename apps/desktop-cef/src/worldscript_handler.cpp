#include "worldscript_handler.h"

#include <cstdio>
#include <unordered_map>

#include "include/cef_app.h"
#include "include/cef_task.h"
#include "include/wrapper/cef_helpers.h"

#include "shutdown_signal.h"

// QNBS-v3: declared not defined — implemented in rust-core, linked in by Corrosion; this is the whole FFI boundary ADR-0020 proves (C++ never implements WorldScript logic itself).
extern "C" int worldscript_rust_ping();

namespace {

constexpr int kShutdownPollIntervalMs = 100;

// QNBS-v3: lookup table (repo convention) over an if/else chain — six real, verified enum values from include/internal/cef_types.h in the pinned CEF branch.
const char* TerminationStatusToString(cef_termination_status_t status) {
  static const std::unordered_map<cef_termination_status_t, const char*> kNames = {
      {TS_ABNORMAL_TERMINATION, "TS_ABNORMAL_TERMINATION"},
      {TS_PROCESS_WAS_KILLED, "TS_PROCESS_WAS_KILLED"},
      {TS_PROCESS_CRASHED, "TS_PROCESS_CRASHED"},
      {TS_PROCESS_OOM, "TS_PROCESS_OOM"},
      {TS_LAUNCH_FAILED, "TS_LAUNCH_FAILED"},
      {TS_INTEGRITY_FAILURE, "TS_INTEGRITY_FAILURE"},
  };
  const auto it = kNames.find(status);
  return it != kNames.end() ? it->second : "TS_UNKNOWN";
}

// QNBS-v3: plain CefTask subclass instead of base::BindOnce — CEF's own ref-counting scheme hit real base::Bind template/header issues (caught by CI, not locally); this is simpler and avoids that machinery entirely.
class PollShutdownTask : public CefTask {
 public:
  explicit PollShutdownTask(CefRefPtr<WorldScriptHandler> handler) : handler_(handler) {}
  void Execute() override { handler_->PollShutdownFlag(); }

 private:
  CefRefPtr<WorldScriptHandler> handler_;

  IMPLEMENT_REFCOUNTING(PollShutdownTask);
  DISALLOW_COPY_AND_ASSIGN(PollShutdownTask);
};

}  // namespace

WorldScriptHandler::WorldScriptHandler() = default;

void WorldScriptHandler::OnTitleChange(CefRefPtr<CefBrowser> browser, const CefString& title) {
  CEF_REQUIRE_UI_THREAD();
  // QNBS-v3: reports the actual title text (not just "a title fired") so the harness can require the specific "WorldScript Studio" title — a CEF error page would not produce it — CodeRabbit/Qodo review finding on PR #388.
  printf("[worldscript_host] title = %s\n", title.ToString().c_str());
  fflush(stdout);
}

void WorldScriptHandler::OnAfterCreated(CefRefPtr<CefBrowser> browser) {
  CEF_REQUIRE_UI_THREAD();
  browser_list_.push_back(browser);
  // QNBS-v3: moved here from OnTitleChange (Qodo review finding on PR #388) — this fires deterministically once per browser regardless of page content, so the FFI-boundary proof no longer depends on the loaded page setting/changing a title.
  printf("[worldscript_host] rust_core ping = %d\n", worldscript_rust_ping());
  fflush(stdout);

  // QNBS-v3: CefClient::GetAccessibilityHandler doesn't exist (PR #391's real finding) — that method is on CefRenderHandler instead, which is OSR-only ("when window rendering is disabled", include/cef_render_handler.h) and doesn't apply to this Views-based windowed host. SetAccessibilityState's own doc comment (include/cef_browser.h) confirms windowed browsers need only this one call: "all platform accessibility objects will be created and managed by Chromium's internal implementation" — no CefAccessibilityHandler required.
  browser->GetHost()->SetAccessibilityState(STATE_ENABLED);
  printf("[worldscript_host] accessibility_state_requested = true\n");
  fflush(stdout);

  CefPostDelayedTask(TID_UI, new PollShutdownTask(this), kShutdownPollIntervalMs);
}

void WorldScriptHandler::PollShutdownFlag() {
  CEF_REQUIRE_UI_THREAD();
  if (g_worldscript_shutdown_requested) {
    // QNBS-v3: TryCloseBrowser (not CloseBrowser(false) directly) — it respects unload handlers and re-signals CanClose once ready, matching cefsimple's real close protocol (CodeRabbit review finding on PR #388).
    for (const auto& browser : browser_list_) {
      browser->GetHost()->TryCloseBrowser();
    }
    return;  // Closing now — no need to keep polling.
  }
  if (!browser_list_.empty()) {
    CefPostDelayedTask(TID_UI, new PollShutdownTask(this), kShutdownPollIntervalMs);
  }
}

void WorldScriptHandler::OnRenderProcessTerminated(CefRefPtr<CefBrowser> browser,
                                                     TerminationStatus status,
                                                     int error_code,
                                                     const CefString& error_string) {
  CEF_REQUIRE_UI_THREAD();
  // QNBS-v3: proof line for the CI harness's crash cycle — the browser process reaching this line at all is itself the "renderer termination observed and handled" evidence (CEF-RUST-COMPETENCY-MATRIX.md), since only the renderer subprocess died.
  printf("[worldscript_host] renderer_terminated status=%s error_code=%d\n",
         TerminationStatusToString(status), error_code);
  fflush(stdout);
}

bool WorldScriptHandler::DoClose(CefRefPtr<CefBrowser> browser) {
  CEF_REQUIRE_UI_THREAD();
  // QNBS-v3: no save-coordinator/state to flush yet (Wave 5+ scope, docs/cef/knowledge/subprocess-and-shutdown.md) — allow the close to proceed.
  return false;
}

void WorldScriptHandler::OnBeforeClose(CefRefPtr<CefBrowser> browser) {
  CEF_REQUIRE_UI_THREAD();
  for (auto it = browser_list_.begin(); it != browser_list_.end(); ++it) {
    if ((*it)->IsSame(browser)) {
      browser_list_.erase(it);
      break;
    }
  }
  if (browser_list_.empty()) {
    // QNBS-v3: the literal mechanism the Wave 2 spike proved (ADR-0020) — makes CefRunMessageLoop() in main() return, the signal to call CefShutdown().
    CefQuitMessageLoop();
  }
}
