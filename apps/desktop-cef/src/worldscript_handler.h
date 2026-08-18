#ifndef WORLDSCRIPT_DESKTOP_CEF_WORLDSCRIPT_HANDLER_H_
#define WORLDSCRIPT_DESKTOP_CEF_WORLDSCRIPT_HANDLER_H_

#include <list>

#include "include/cef_client.h"

// QNBS-v3: browser-process lifecycle/display callbacks only (ADR-0020 scorecard) — renderer-process-specific handlers (CefRenderProcessHandler) are explicitly out of scope for this proof.
class WorldScriptHandler : public CefClient,
                            public CefLifeSpanHandler,
                            public CefDisplayHandler {
 public:
  WorldScriptHandler();

  CefRefPtr<CefLifeSpanHandler> GetLifeSpanHandler() override { return this; }
  CefRefPtr<CefDisplayHandler> GetDisplayHandler() override { return this; }

  void OnTitleChange(CefRefPtr<CefBrowser> browser, const CefString& title) override;

  void OnAfterCreated(CefRefPtr<CefBrowser> browser) override;
  bool DoClose(CefRefPtr<CefBrowser> browser) override;
  void OnBeforeClose(CefRefPtr<CefBrowser> browser) override;

 private:
  // QNBS-v3: polls g_worldscript_shutdown_requested from the UI thread (never from the signal handler itself) and, when set, requests a graceful close on every tracked browser via TryCloseBrowser.
  void PollShutdownFlag();

  std::list<CefRefPtr<CefBrowser>> browser_list_;

  IMPLEMENT_REFCOUNTING(WorldScriptHandler);
  DISALLOW_COPY_AND_ASSIGN(WorldScriptHandler);
};

#endif  // WORLDSCRIPT_DESKTOP_CEF_WORLDSCRIPT_HANDLER_H_
