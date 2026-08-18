#ifndef WORLDSCRIPT_DESKTOP_CEF_WORLDSCRIPT_HANDLER_H_
#define WORLDSCRIPT_DESKTOP_CEF_WORLDSCRIPT_HANDLER_H_

#include <list>

#include "include/cef_client.h"

// QNBS-v3: browser-process lifecycle/display/accessibility callbacks only (ADR-0020 scorecard) — renderer-process-specific handlers (CefRenderProcessHandler) are explicitly out of scope for this proof.
class WorldScriptHandler : public CefClient,
                            public CefLifeSpanHandler,
                            public CefDisplayHandler,
                            public CefAccessibilityHandler {
 public:
  WorldScriptHandler();

  CefRefPtr<CefLifeSpanHandler> GetLifeSpanHandler() override { return this; }
  CefRefPtr<CefDisplayHandler> GetDisplayHandler() override { return this; }
  CefRefPtr<CefAccessibilityHandler> GetAccessibilityHandler() override { return this; }

  void OnTitleChange(CefRefPtr<CefBrowser> browser, const CefString& title) override;

  void OnAfterCreated(CefRefPtr<CefBrowser> browser) override;
  bool DoClose(CefRefPtr<CefBrowser> browser) override;
  void OnBeforeClose(CefRefPtr<CefBrowser> browser) override;

  // QNBS-v3: Early Accessibility Gate smoke test (roadmap §3142) — logs once when CEF's accessibility tree is actually built, not just requested.
  void OnAccessibilityTreeChange(CefRefPtr<CefValue> value) override;

  // QNBS-v3: public (not private) — called from PollShutdownTask::Execute(), an unrelated class in worldscript_handler.cpp's anonymous namespace; polls g_worldscript_shutdown_requested from the UI thread and requests a graceful close via TryCloseBrowser when set.
  void PollShutdownFlag();

 private:
  std::list<CefRefPtr<CefBrowser>> browser_list_;
  bool accessibility_tree_change_logged_ = false;

  IMPLEMENT_REFCOUNTING(WorldScriptHandler);
  DISALLOW_COPY_AND_ASSIGN(WorldScriptHandler);
};

#endif  // WORLDSCRIPT_DESKTOP_CEF_WORLDSCRIPT_HANDLER_H_
