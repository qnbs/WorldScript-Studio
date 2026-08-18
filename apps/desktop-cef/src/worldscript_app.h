#ifndef WORLDSCRIPT_DESKTOP_CEF_WORLDSCRIPT_APP_H_
#define WORLDSCRIPT_DESKTOP_CEF_WORLDSCRIPT_APP_H_

#include <string>

#include "include/cef_app.h"

// WorldScriptApp: bootstraps a single top-level window via CEF's Views framework
// (cross-platform window toolkit — avoids raw X11/GTK window code, matching the
// modern cefsimple convention). C++ owns CEF integration only (ADR-0020); no
// WorldScript business logic belongs here.
class WorldScriptApp : public CefApp, public CefBrowserProcessHandler {
 public:
  explicit WorldScriptApp(std::string start_url);

  CefRefPtr<CefBrowserProcessHandler> GetBrowserProcessHandler() override { return this; }

  void OnContextInitialized() override;

 private:
  std::string start_url_;

  IMPLEMENT_REFCOUNTING(WorldScriptApp);
  DISALLOW_COPY_AND_ASSIGN(WorldScriptApp);
};

#endif  // WORLDSCRIPT_DESKTOP_CEF_WORLDSCRIPT_APP_H_
