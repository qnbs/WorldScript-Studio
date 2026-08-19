#include <cstdio>
#include <string>

#include "include/cef_app.h"
#include "include/cef_crash_util.h"

#include "shutdown_signal.h"
#include "worldscript_app.h"

// QNBS-v3: crash-symbolization proof (Wave 2 exit criterion) — only ever invoked behind
// --debug-crash-self below, never reachable in normal operation.
extern "C" void worldscript_rust_debug_crash_self_test();

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

bool HasDebugCrashSelfFlag(int argc, char* argv[]) {
  for (int i = 1; i < argc; ++i) {
    if (std::string(argv[i]) == "--debug-crash-self") {
      return true;
    }
  }
  return false;
}

}  // namespace

int main(int argc, char* argv[]) {
  CefMainArgs main_args(argc, argv);

  const bool debug_crash_self = HasDebugCrashSelfFlag(argc, argv);
  CefRefPtr<WorldScriptApp> app(new WorldScriptApp(ParseStartUrl(argc, argv)));

  // QNBS-v3: every CEF host re-executes itself for renderer/GPU/utility subprocesses — must run before CefInitialize; non-negative return means this invocation *was* one of those, already run to completion.
  int exit_code = CefExecuteProcess(main_args, app.get(), nullptr);
  if (exit_code >= 0) {
    return exit_code;
  }

  // QNBS-v3: installed only in the real browser process (past the subprocess check above) — CodeRabbit review finding on PR #388: a raw, unhandled SIGTERM bypassed OnBeforeClose/CefQuitMessageLoop/CefShutdown entirely.
  InstallShutdownSignalHandlers();

  CefSettings settings;
  settings.no_sandbox = true;  // ADR-0020: sandbox posture deliberately deferred (roadmap §12).

  // QNBS-v3: CefInitialize's return value was previously ignored, masking init failure (missing display/resources) as a normal exit — CodeAnt review finding on PR #388.
  if (!CefInitialize(main_args, settings, app.get(), nullptr)) {
    fprintf(stderr, "[worldscript_host] CefInitialize failed\n");
    return 1;
  }

  // QNBS-v3: CefCrashReportingEnabled() reflects whether crash_reporter.cfg (copied next to this binary by CMakeLists.txt) was found and parsed — the CI harness asserts on this line, not just on the .cfg file existing on disk.
  printf("[worldscript_host] crash_reporting_enabled = %s\n",
         CefCrashReportingEnabled() ? "true" : "false");
  fflush(stdout);

  // QNBS-v3: Wave 2 crash-symbolization proof only — deliberately crashes the browser
  // process itself (not a renderer subprocess) so the resulting dump's stack is our own
  // code, not Chromium/CEF internals we have no debug symbols for.
  if (debug_crash_self) {
    printf("[worldscript_host] debug_crash_self_test = triggering\n");
    fflush(stdout);
    worldscript_rust_debug_crash_self_test();
  }

  CefRunMessageLoop();
  CefShutdown();

  return 0;
}
