#include "worldscript_handler.h"

#include <cstdio>

#include "include/cef_app.h"
#include "include/wrapper/cef_helpers.h"

// Declared, not defined, here — implemented in rust-core and linked in by
// CMake (Corrosion). This is the whole FFI boundary ADR-0020 proves: C++ never
// implements WorldScript logic itself, only calls into Rust for it.
extern "C" int worldscript_rust_ping();

WorldScriptHandler::WorldScriptHandler() = default;

void WorldScriptHandler::OnTitleChange(CefRefPtr<CefBrowser> browser, const CefString& title) {
  CEF_REQUIRE_UI_THREAD();
  // ADR-0020's proof point, exercised from inside a real CEF callback (not a
  // decoupled test binary) — CI greps this exact line for FFI-boundary evidence.
  printf("[worldscript_host] rust_core ping = %d\n", worldscript_rust_ping());
  fflush(stdout);
}

void WorldScriptHandler::OnAfterCreated(CefRefPtr<CefBrowser> browser) {
  CEF_REQUIRE_UI_THREAD();
  browser_list_.push_back(browser);
}

bool WorldScriptHandler::DoClose(CefRefPtr<CefBrowser> browser) {
  CEF_REQUIRE_UI_THREAD();
  // No save-coordinator/state to flush yet — that protocol step is Wave 5+ scope
  // (docs/cef/knowledge/subprocess-and-shutdown.md). Allow the close to proceed.
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
    // The literal mechanism the Wave 2 spike proved (ADR-0020): this is what
    // makes CefRunMessageLoop() in main() return, the signal to call CefShutdown().
    CefQuitMessageLoop();
  }
}
