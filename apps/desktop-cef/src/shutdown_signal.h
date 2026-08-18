#ifndef WORLDSCRIPT_DESKTOP_CEF_SHUTDOWN_SIGNAL_H_
#define WORLDSCRIPT_DESKTOP_CEF_SHUTDOWN_SIGNAL_H_

#include <csignal>

// QNBS-v3: CEF APIs are not async-signal-safe (CodeRabbit review finding on PR #388) — the signal handler only sets this flag; the actual CloseBrowser/CefQuitMessageLoop/CefShutdown sequence runs from a normal UI-thread task that polls it.
extern volatile std::sig_atomic_t g_worldscript_shutdown_requested;

void InstallShutdownSignalHandlers();

#endif  // WORLDSCRIPT_DESKTOP_CEF_SHUTDOWN_SIGNAL_H_
