#include <string>

#include "include/cef_app.h"

#include "worldscript_app.h"

namespace {

// Defaults to about:blank so a bare invocation (e.g. a subprocess re-exec) never
// depends on --url being present; the real harness always passes it explicitly.
std::string ParseStartUrl(int argc, char* argv[]) {
  const std::string prefix = "--url=";
  for (int i = 1; i < argc; ++i) {
    const std::string arg = argv[i];
    if (arg.rfind(prefix, 0) == 0) {
      return arg.substr(prefix.size());
    }
  }
  return "about:blank";
}

}  // namespace

int main(int argc, char* argv[]) {
  CefMainArgs main_args(argc, argv);

  CefRefPtr<WorldScriptApp> app(new WorldScriptApp(ParseStartUrl(argc, argv)));

  // Every CEF host re-executes itself for renderer/GPU/utility subprocesses; this
  // must run before CefInitialize (ADR-0020's documented multi-process architecture
  // note). A non-negative return means this invocation *was* one of those
  // subprocesses, already run to completion.
  int exit_code = CefExecuteProcess(main_args, app.get(), nullptr);
  if (exit_code >= 0) {
    return exit_code;
  }

  CefSettings settings;
  settings.no_sandbox = true;  // ADR-0020: sandbox posture deliberately deferred (roadmap §12).

  CefInitialize(main_args, settings, app.get(), nullptr);
  CefRunMessageLoop();
  CefShutdown();

  return 0;
}
