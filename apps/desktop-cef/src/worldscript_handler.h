#ifndef WORLDSCRIPT_DESKTOP_CEF_WORLDSCRIPT_HANDLER_H_
#define WORLDSCRIPT_DESKTOP_CEF_WORLDSCRIPT_HANDLER_H_

#include <list>

#include "include/cef_client.h"

// WorldScriptHandler: browser-process lifecycle/display callbacks only (ADR-0020
// scorecard — "browser-process handlers exercised"; renderer-process-specific
// handlers like CefRenderProcessHandler are explicitly out of scope for this proof).
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
  std::list<CefRefPtr<CefBrowser>> browser_list_;

  IMPLEMENT_REFCOUNTING(WorldScriptHandler);
  DISALLOW_COPY_AND_ASSIGN(WorldScriptHandler);
};

#endif  // WORLDSCRIPT_DESKTOP_CEF_WORLDSCRIPT_HANDLER_H_
