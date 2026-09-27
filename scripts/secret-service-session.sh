#!/usr/bin/env sh
# Runs a command inside an already-started D-Bus session with a freshly unlocked, throwaway
# gnome-keyring Secret Service (R-15 Gate 1b-platform evidence). It waits until
# org.freedesktop.secrets is actually owned before running the command, so D-Bus never activates a
# second, locked keyring daemon in between.
set -eu
printf 'evidence' | gnome-keyring-daemon --unlock --components=secrets >/dev/null
# --unlock starts the daemon with an unlocked login keyring; --start then attaches to it and
# publishes the Secret Service interface on the session bus.
gnome-keyring-daemon --start --components=secrets >/dev/null
tries=0
until dbus-send --session --print-reply --dest=org.freedesktop.DBus /org/freedesktop/DBus \
  org.freedesktop.DBus.NameHasOwner string:org.freedesktop.secrets 2>/dev/null | grep -q 'boolean true'; do
  tries=$((tries + 1))
  if [ "$tries" -gt 50 ]; then
    echo "org.freedesktop.secrets never appeared on the session bus" >&2
    exit 1
  fi
  sleep 0.2
done
exec "$@"
