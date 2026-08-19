#ifndef WORLDSCRIPT_DESKTOP_CEF_WORLDSCRIPT_HANDLER_H_
#define WORLDSCRIPT_DESKTOP_CEF_WORLDSCRIPT_HANDLER_H_

#include <list>

#include "include/cef_client.h"

// QNBS-v3: browser-process lifecycle/display/request callbacks only (ADR-0020 scorecard) — renderer-process-specific handlers (CefRenderProcessHandler) are explicitly out of scope for this proof.
class WorldScriptHandler : public CefClient,
                            public CefLifeSpanHandler,
                            public CefDisplayHandler,
                            public CefRequestHandler {
 public:
  WorldScriptHandler();

  CefRefPtr<CefLifeSpanHandler> GetLifeSpanHandler() override { return this; }
  CefRefPtr<CefDisplayHandler> GetDisplayHandler() override { return this; }
  CefRefPtr<CefRequestHandler> GetRequestHandler() override { return this; }

  void OnTitleChange(CefRefPtr<CefBrowser> browser, const CefString& title) override;

  void OnAfterCreated(CefRefPtr<CefBrowser> browser) override;
  bool DoClose(CefRefPtr<CefBrowser> browser) override;
  void OnBeforeClose(CefRefPtr<CefBrowser> browser) override;

  // QNBS-v3: real, verified CefRequestHandler method (unlike the reverted GetAccessibilityHandler attempt) — fires in the browser process when a renderer subprocess dies; the browser process itself and CefRunMessageLoop() keep running.
  void OnRenderProcessTerminated(CefRefPtr<CefBrowser> browser,
                                  TerminationStatus status,
                                  int error_code,
                                  const CefString& error_string) override;

  // QNBS-v3: public (not private) — called from PollShutdownTask::Execute(), an unrelated class in worldscript_handler.cpp's anonymous namespace; polls g_worldscript_shutdown_requested from the UI thread and requests a graceful close via TryCloseBrowser when set.
  void PollShutdownFlag();

 private:
  std::list<CefRefPtr<CefBrowser>> browser_list_;

  IMPLEMENT_REFCOUNTING(WorldScriptHandler);
  DISALLOW_COPY_AND_ASSIGN(WorldScriptHandler);
};

#endif  // WORLDSCRIPT_DESKTOP_CEF_WORLDSCRIPT_HANDLER_H_
