#ifndef WORLDSCRIPT_DESKTOP_CEF_WORLDSCRIPT_APP_H_
#define WORLDSCRIPT_DESKTOP_CEF_WORLDSCRIPT_APP_H_

#include <string>

#include "include/cef_app.h"

// QNBS-v3: bootstraps a single top-level window via CEF's Views framework (avoids raw X11/GTK code, matching cefsimple) — C++ owns CEF integration only (ADR-0020), no WorldScript logic here.
class WorldScriptApp : public CefApp, public CefBrowserProcessHandler {
 public:
  explicit WorldScriptApp(std::string start_url);

  CefRefPtr<CefBrowserProcessHandler> GetBrowserProcessHandler() override { return this; }

  void OnContextInitialized() override;

  // QNBS-v3: forces the renderer to build a real accessibility tree even with no AT client attached (Chromium normally builds it lazily) — Early Accessibility Gate smoke test, roadmap §3142.
  void OnBeforeCommandLineProcessing(const CefString& process_type,
                                      CefRefPtr<CefCommandLine> command_line) override;

 private:
  std::string start_url_;

  IMPLEMENT_REFCOUNTING(WorldScriptApp);
  DISALLOW_COPY_AND_ASSIGN(WorldScriptApp);
};

#endif  // WORLDSCRIPT_DESKTOP_CEF_WORLDSCRIPT_APP_H_
