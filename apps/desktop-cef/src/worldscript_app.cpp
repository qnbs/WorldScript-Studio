#include "worldscript_app.h"

#include <utility>

#include "include/cef_browser.h"
#include "include/views/cef_browser_view.h"
#include "include/views/cef_window.h"
#include "include/wrapper/cef_helpers.h"

#include "worldscript_handler.h"

namespace {

// Window-close policy only (cefsimple convention): request the browser close,
// then always allow the window itself to close — CanClose is not a place to
// re-derive that answer, it just triggers the real close and lets it proceed.
class WorldScriptWindowDelegate : public CefWindowDelegate {
 public:
  explicit WorldScriptWindowDelegate(CefRefPtr<CefBrowserView> browser_view)
      : browser_view_(browser_view) {}

  void OnWindowCreated(CefRefPtr<CefWindow> window) override {
    window->AddChildView(browser_view_);
    window->Show();
    browser_view_->RequestFocus();
  }

  void OnWindowDestroyed(CefRefPtr<CefWindow> window) override { browser_view_ = nullptr; }

  bool CanClose(CefRefPtr<CefWindow> window) override {
    CefRefPtr<CefBrowser> browser = browser_view_ ? browser_view_->GetBrowser() : nullptr;
    if (browser) {
      browser->GetHost()->CloseBrowser(false);
    }
    return true;
  }

  CefSize GetPreferredSize(CefRefPtr<CefView> view) override { return CefSize(1024, 768); }

 private:
  CefRefPtr<CefBrowserView> browser_view_;

  IMPLEMENT_REFCOUNTING(WorldScriptWindowDelegate);
  DISALLOW_COPY_AND_ASSIGN(WorldScriptWindowDelegate);
};

class WorldScriptBrowserViewDelegate : public CefBrowserViewDelegate {
 public:
  WorldScriptBrowserViewDelegate() = default;

 private:
  IMPLEMENT_REFCOUNTING(WorldScriptBrowserViewDelegate);
  DISALLOW_COPY_AND_ASSIGN(WorldScriptBrowserViewDelegate);
};

}  // namespace

WorldScriptApp::WorldScriptApp(std::string start_url) : start_url_(std::move(start_url)) {}

void WorldScriptApp::OnContextInitialized() {
  CEF_REQUIRE_UI_THREAD();

  CefRefPtr<WorldScriptHandler> handler(new WorldScriptHandler());
  CefBrowserSettings browser_settings;

  CefRefPtr<CefBrowserViewDelegate> browser_view_delegate = new WorldScriptBrowserViewDelegate();
  CefRefPtr<CefBrowserView> browser_view = CefBrowserView::CreateBrowserView(
      handler, start_url_, browser_settings, nullptr, nullptr, browser_view_delegate);

  CefWindow::CreateTopLevelWindow(new WorldScriptWindowDelegate(browser_view));
}
