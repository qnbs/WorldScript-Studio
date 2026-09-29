# v1.29.0 packaged-state qualification protocol

Purpose: prove that the **real built v1.29.0 candidate** boots correctly on top of persisted state
written by older builds. This is the v1.28.7 failure class (a published AppImage dead-ended on a
refused active project) and the v1.28.8 recovery. Green CI or a successful build does not satisfy
this protocol. Results go to `docs/RELEASE-V1.29.0-EVIDENCE.md` and #872.

Part 1 is the primary gate: a reproducible, headless reconstruction of the v1.28.8 real-artifact
method recorded in `AUDIT.md`. Part 2 is additional target-environment evidence on the maintainer's
own Linux system. It does not replace Part 1.

## Ground rules (both parts)

- **Never touch real WorldScript data.** Every launch runs with a fresh temporary `HOME` and
  `XDG_DATA_HOME`/`XDG_CONFIG_HOME`/`XDG_CACHE_HOME`/`XDG_STATE_HOME` under one throwaway
  directory. The real `~/.local/share/com.worldscript.studio` must not be read or written. Record
  its `stat`/hash before and after as proof.
- Use the **exact candidate artifacts** from the `tauri-build.yml` `workflow_dispatch` run on the
  candidate SHA. Record the run ID and the SHA-256 of every artifact used.
- Maturity labels: `PACKAGED_CANDIDATE_HEADLESS` (Part 1), `PACKAGED_TARGET_ENV` (Part 2),
  `NOT_REPRODUCED_ENVIRONMENT_LIMITED` (the environment could not run it; say why).

## On-disk facts this protocol relies on

- App data directory: `$XDG_DATA_HOME/com.worldscript.studio` (Tauri `appDataDir()`).
- Project: `projects/<id>/project.json` (plus `.incarnation`, `codex/…`); a transient
  `project.json.lock` exists only during a write.
- Active-project marker: `config/active-project-id.txt`.
- Schema classes (`features/project/projectSchemaVersion.ts`): `schemaVersion` `1` = CURRENT,
  `≥ 2` = FUTURE, `0` = UNSUPPORTED_OLDER, field absent = legacy (`LEGACY_TO_V1` migration).
- Expected refusal copy:
  - FUTURE: `error.startup.projectUnsupported` (“…uses a schema version this build cannot edit…”);
  - UNSUPPORTED_OLDER: `error.startup.projectMigrationGap` (“…older schema version that this build
    cannot migrate…”);
  - Safe Open action: “Open WorldScript Studio without this project”;
  - notice: `error.startup.safeOpenNotice`.

## Fixtures (persisted state from other builds)

1. **CURRENT base from a real older release:** launch the published **v1.28.8** AppImage in an
   isolated profile, create one project with a distinctive title and a manuscript line, and quit
   normally. The resulting `projects/<id>/` and marker are real v1.28.8 output.
2. **FUTURE:** copy that project to a fresh profile, change only the top-level `"schemaVersion": 1`
   token to `2`, give it its own distinctive title, and point `active-project-id.txt` at it.
3. **UNSUPPORTED_OLDER:** a *separate* copy with its own title, `"schemaVersion": 0`, and its own
   profile. Never relabel the FUTURE fixture.
4. **Legacy:** a project directory whose `project.json` has **no** `schemaVersion`, built from
   `tests/fixtures/project-golden-masters/typical-project.json` with a stable `id`, in its own
   profile, marked active.

Record `sha256sum` of every fixture file and the marker before first launch.

## Part 1 — headless real-artifact qualification (primary gate)

Environment: `Xvfb :99`, `DISPLAY=:99`, the AppImage launched with
`--appimage-extract-and-run` (no FUSE), and real input through XTest (`xdotool`). Screenshots come
from the virtual display. No mocked UI and no dev server.

**A. FUTURE**
1. Launch the candidate on the FUTURE profile.
2. Expect the `projectUnsupported` copy, the Safe Open action and the notice, and **no**
   “Continue”-style action for the refused project.
3. Click Safe Open. Expect the portal with no project loaded.
4. Before creating anything: the refused `project.json` hash is unchanged and
   `active-project-id.txt` still names the refused ID.
5. Create a new blank project and let it save. Expect the marker to change to a new
   `project-<uuid>`, the new project's files (including auxiliary `codex/…` writes) under that new
   ID, and the refused project's directory untouched (same hash, same file list).
6. Quit and relaunch. The refused project still refuses the same way; the new project is
   unaffected.

**B. UNSUPPORTED_OLDER:** the same steps as A on its own fixture, expecting the
`projectMigrationGap` copy.

**C. Legacy migration + reopen**
1. Launch on the legacy profile. The project must open, admitted through `LEGACY_TO_V1`.
2. Expect the #849 pre-migration snapshot to be written (record where it lands), and a durable
   `project.json` that now
   carries `schemaVersion: 1` and preserves every modeled field of the fixture (title, logline,
   author, characters, worlds, manuscript content and IDs/order).
3. Quit and relaunch. Content is identical; no second migration; no field dropped; the source
   snapshot is intact.

**D. Stale writer / second instance**
1. Run the existing harnesses on the candidate SHA:
   `tests/unit/services/fs/{fsCore,fsStores,projectFsStore}.test.ts` and
   `tests/unit/services/projectAutosave*.test.ts`.
2. Packaged check: while the app runs, start the AppImage a second time on the same profile.
   Expect no second app process to remain (`tauri-plugin-single-instance` focuses the first), and
   no concurrent writer: the project file hash changes only through the first instance's saves.

Pass criteria: every expectation above holds, and the real profile proof is unchanged. Any
deviation is a release blocker until classified.

## Part 2 — maintainer target-environment protocol

Run as your normal user on your Linux desktop. Everything lives under one throwaway directory.

```bash
# 0. One throwaway root; the real WorldScript data dir is only hashed, never used.
export Q="$(mktemp -d /tmp/wss-v129-qual.XXXXXX)"
find ~/.local/share/com.worldscript.studio -type f -exec sha256sum {} + 2>/dev/null | sort > "$Q/real-before.txt"

# 1. Candidate artifacts (the run ID is given in the evidence record).
gh run download <DISPATCH_RUN_ID> --repo qnbs/WorldScript-Studio --name tauri-bundle-ubuntu-22.04 --dir "$Q/art"
APPIMAGE="$(find "$Q/art" -name '*.AppImage' | head -1)"; chmod +x "$APPIMAGE"; sha256sum "$APPIMAGE" > "$Q/artifact.sha256"

# 2. Isolated launcher: every run gets its own HOME and XDG dirs.
run_isolated() { P="$Q/profile-$1"; mkdir -p "$P"/{home,data,config,cache,state};
  HOME="$P/home" XDG_DATA_HOME="$P/data" XDG_CONFIG_HOME="$P/config" \
  XDG_CACHE_HOME="$P/cache" XDG_STATE_HOME="$P/state" "$APPIMAGE"; }
```

3. The prepared fixtures from Part 1 (`profile-future`, `profile-older`, `profile-legacy`) are
   copied into `$Q`. Run `run_isolated future`, then `older`, then `legacy`, and for each confirm
   the visible states listed in A–C. Take one screenshot per state.
4. `.deb` (optional): installing it replaces any installed WorldScript Studio system-wide. Your
   data stays untouched because launches still go through the isolated `HOME`/`XDG_*`
   (`HOME=… XDG_DATA_HOME=… worldscript-studio`). Reinstall your previous version afterwards if
   you want it back.
5. Return the evidence:

```bash
find "$Q"/profile-* -type f \( -name project.json -o -name active-project-id.txt \) -exec sha256sum {} + | sort > "$Q/fixtures-after.txt"
find ~/.local/share/com.worldscript.studio -type f -exec sha256sum {} + 2>/dev/null | sort > "$Q/real-after.txt"
diff "$Q/real-before.txt" "$Q/real-after.txt" && echo "REAL DATA UNCHANGED"
tar czf "$Q.tgz" -C "$Q" artifact.sha256 fixtures-after.txt real-before.txt real-after.txt
```

Attach the `.tgz` and screenshots, and note the distribution, desktop environment,
Wayland/X11 and WebKitGTK version.
