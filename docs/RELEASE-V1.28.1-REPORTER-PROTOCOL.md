# v1.28.1 packaged reporter protocol

This protocol is for the published v1.28.1 Linux `.deb`. It supplies evidence for the open
packaged-runtime questions in #332 and #341; green CI, a successful release workflow, or a PWA
result does not close either issue.

## Record the environment first

For every run, record the release tag and build SHA, package version, `.deb` filename, Linux
distribution, desktop environment/compositor, Wayland or X11, display scale/resolution, GPU and
driver, Tauri/WebKitGTK versions when available, launch path (application menu or terminal), and
result maturity (`PACKAGED_TARGET_ENV`, `PACKAGED_LOCAL`, or `NOT_REPRODUCED_ENVIRONMENT_LIMITED`).
Keep the PWA comparison on the same source revision and record it separately.

## #332: lifecycle, Alt+Tab, and persistence

1. Install the new `.deb` cleanly and start the packaged app from the normal desktop launcher.
   Confirm the process and window are the packaged build, not the PWA or a development server.
2. Create or open a disposable project. Change an appearance setting, make a manuscript edit,
   and perform the relevant Settings navigation. Repeat the navigation sequence enough to record
   a small before/after sample (at least 10 transitions); note visible feedback latency and any
   freeze, dropped input, or delayed repaint.
3. While the app is idle and while a save is settling, use Alt+Tab away for at least 30 seconds,
   then return. Repeat with a longer interval if the first pass is clean. Record whether the
   window repaints, accepts input, and preserves the project without a forced termination.
4. Change the appearance setting again, wait for the save to settle, quit through the normal
   application path, relaunch from the desktop launcher, and verify the edit and appearance
   setting. Repeat once after an Alt+Tab cycle to distinguish ordinary relaunch persistence from
   lifecycle recovery.
5. If the app becomes unresponsive, capture timestamps, visible window/process state, and the
   last interaction before using a forced kill as recovery. A forced kill is evidence of the
   symptom, not a closure decision. Attach logs and the exact reproduction sequence.

Report separate results for navigation responsiveness, Alt+Tab recovery, and durable persistence;
do not collapse them into a single “fixed” claim.

## #341: dark/sepia and PWA-versus-packaged readability

1. In the packaged `.deb`, inspect the same manuscript content in the default, dark, and sepia
   appearance presets. Check normal prose, headings, selected text, editor overlays, links, and
   focused controls at the supported zoom/display scale.
2. Repeat the identical content and presets in the PWA from the same release source. Record the
   computed foreground/background colors and contrast where the symptom appears, plus screenshots
   showing the full surface rather than only selected text.
3. Relaunch the packaged build after each dark/sepia change and repeat the inspection. Note any
   reset, black-on-dark text, overlay occlusion, font mismatch, missing scroll synchronization,
   or difference between the packaged WebKitGTK surface and the Chromium PWA.
4. Record the result as reproduced, not reproduced, or environment-limited. A clean PWA result is
   a comparison signal only; it cannot substitute for packaged evidence.

Attach screenshots, the computed style values, and the environment record to the issue report.
Keep #341 open until the packaged matrix has a reproducible outcome and an explicit maintainer
decision.

## Release limitations

PWA remains first-class. Tauri remains transitional, and Qt remains the future native target
behind its early killer gates. v1.28.1 makes no unsupported macOS Intel artifact claim.
