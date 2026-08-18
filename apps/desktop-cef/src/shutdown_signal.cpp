#include "shutdown_signal.h"

// QNBS-v3: sigaction/sigemptyset are POSIX, not standard C++ — <csignal> alone doesn't guarantee them; this file is Linux-only per the app's own OS_LINUX scoping.
#include <signal.h>

volatile std::sig_atomic_t g_worldscript_shutdown_requested = 0;

namespace {

void HandleShutdownSignal(int /*signum*/) {
  g_worldscript_shutdown_requested = 1;
}

}  // namespace

void InstallShutdownSignalHandlers() {
  struct sigaction action = {};
  action.sa_handler = HandleShutdownSignal;
  sigemptyset(&action.sa_mask);
  action.sa_flags = 0;
  // QNBS-v3: SIGINT alongside SIGTERM — a dev running the host interactively expects Ctrl+C to trigger the same graceful path, not the OS default abrupt kill.
  sigaction(SIGTERM, &action, nullptr);
  sigaction(SIGINT, &action, nullptr);
}
