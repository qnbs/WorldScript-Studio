#include <cstdio>
#include <string>

#include "include/cef_app.h"

#include "worldscript_app.h"

namespace {

// QNBS-v3: defaults to about:blank so a bare invocation (e.g. a subprocess re-exec) never depends on --url being present.
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

  // QNBS-v3: every CEF host re-executes itself for renderer/GPU/utility subprocesses — must run before CefInitialize; non-negative return means this invocation *was* one of those, already run to completion.
  int exit_code = CefExecuteProcess(main_args, app.get(), nullptr);
  if (exit_code >= 0) {
    return exit_code;
  }

  CefSettings settings;
  settings.no_sandbox = true;  // ADR-0020: sandbox posture deliberately deferred (roadmap §12).

  // QNBS-v3: CefInitialize's return value was previously ignored, masking init failure (missing display/resources) as a normal exit — CodeAnt review finding on PR #388.
  if (!CefInitialize(main_args, settings, app.get(), nullptr)) {
    fprintf(stderr, "[worldscript_host] CefInitialize failed\n");
    return 1;
  }

  CefRunMessageLoop();
  CefShutdown();

  return 0;
}
