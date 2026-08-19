#include <cstdio>
#include <string>

#include <linux/prctl.h>
#include <sys/prctl.h>

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
  // QNBS-v3: real fix attempt for the renderer-crash-dump-under-sandbox regression (PR #404) —
  // must run before CefExecuteProcess since every subprocess role (renderer/GPU/utility) re-execs
  // through this exact same main() entry point. PR_SET_PTRACER_ANY is the real, documented
  // Chromium/Linux-kernel mechanism for exactly this scenario (Yama LSM docs; real-world precedent
  // in Chromium's own Linux crash-dumping architecture, which needs it because the crash handler
  // runs external to a sandboxed renderer's own PID namespace): it lets ANY process attach via
  // ptrace, bypassing the requirement to declare one specific, namespace-relative PID that a
  // PID-namespaced renderer cannot correctly resolve for an externally-running crash handler.
  // Best-effort: failure here (e.g. Yama LSM not loaded on this kernel) does not abort startup —
  // it only means this specific mitigation is unavailable, same as before this fix existed.
  prctl(PR_SET_PTRACER, PR_SET_PTRACER_ANY, 0, 0, 0);

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
  // QNBS-v3: real sandbox-enable attempt (Wave 2 exit criterion) — ADR-0020's spike ran with
  // no_sandbox=true unconditionally; PR #402's feasibility inventory confirmed unprivileged
  // user-namespace sandboxing is functionally reachable on the CI runner (unshare succeeded),
  // so this attempt lets CEF/Chromium's own sandbox init run for real rather than assuming it
  // would fail. scripts/cef/run-sandbox-status-proof.mjs reads real per-process evidence
  // (Seccomp/NoNewPrivs, user-namespace identity) rather than trusting a clean launch alone.
  settings.no_sandbox = false;

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
