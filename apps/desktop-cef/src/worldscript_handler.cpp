#include "worldscript_handler.h"

#include <cstdio>

#include "include/cef_app.h"
#include "include/wrapper/cef_closure_task.h"
#include "include/wrapper/cef_helpers.h"

#include "shutdown_signal.h"

// QNBS-v3: declared not defined — implemented in rust-core, linked in by Corrosion; this is the whole FFI boundary ADR-0020 proves (C++ never implements WorldScript logic itself).
extern "C" int worldscript_rust_ping();

namespace {
constexpr int kShutdownPollIntervalMs = 100;
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

  CefPostDelayedTask(TID_UI, base::BindOnce(&WorldScriptHandler::PollShutdownFlag, this),
                     kShutdownPollIntervalMs);
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
    CefPostDelayedTask(TID_UI, base::BindOnce(&WorldScriptHandler::PollShutdownFlag, this),
                       kShutdownPollIntervalMs);
  }
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
