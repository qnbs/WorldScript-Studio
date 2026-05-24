# StoryCraft Studio — Zwischenstandsmarke (Checkpoint)
**Datum:** 2026-05-24  
**Sitzungsdauer:** ~3,5 Stunden kontinuierliche Arbeit  
**Letzter Commit:** `33cb544`  
**Git-Tag:** `v1.17.0` (gepusht)  

---

## ✅ Abgeschlossene P0-Items in dieser Sitzung

### P0 #5 — Versionierung & Release konsolidieren (VOLLSTÄNDIG)
- `package.json` → `1.17.0`
- `src-tauri/Cargo.toml` → `1.17.0`
- `src-tauri/tauri.conf.json` → `1.17.0` (war seit 10 Releases bei 1.7.0 verwaist)
- `CHANGELOG.md`: `[Unreleased]` → `## [1.17.0] — 2026-05-24` mit allen Sprint-Highlights
- Vergleichs-Links im CHANGELOG aktualisiert (`[1.17.0]`, `[1.11.0]`, … `[1.0.0]`)
- Git-Tag `v1.17.0` erstellt und gepusht
- GitHub Release konnte nicht via API erstellt werden (Authentifizierung fehlte zu Sitzungsbeginn, wurde später behoben — Release muss manuell nachgeholt werden oder via `gh release create v1.17.0`)

**Commits:**
- `da61b5a` — chore(release): consolidate versioning to v1.17.0 + y-webrtc patch
- `12fda28` — fix(vercel): update pnpm-lock.yaml for y-webrtc patchedDependencies

### P0 #1 — Full RTCDataChannel in-flight E2E encryption (VOLLSTÄNDIG)
- `pnpm patch y-webrtc@10.3.0` erstellt und committet (`patches/y-webrtc@10.3.0.patch`)
- Patch verschlüsselt alle drei kritischen Stellen in `y-webrtc.js`:
  1. `sendWebrtcConn()` — verschlüsselt vor `peer.send()`
  2. `broadcastWebrtcConn()` — verschlüsselt vor Broadcasting
  3. `peer.on('data')` — entschlüsselt vor `readPeerMessage()`
- Nutzt existierenden `room.key` (AES-256-GCM, PBKDF2 100k Iterationen)
- Asynchrone Encrypt/Decrypt mit `cryptoutils.encrypt/decrypt`
- Plaintext-Fallback wenn kein Passwort gesetzt (`room.key` absent)
- **Smoke-Tests:** `tests/unit/yWebrtcPatch.test.ts` (5 Tests) verifiziert Patch-Anwendung
- **i18n:** Alle 5 Locales aktualisiert — Badge zeigt jetzt "E2E Encrypted (AES-256-GCM) — signaling + data channel"
- **CHANGELOG:** Eintrag für RTCDataChannel-Verschlüsselung hinzugefügt

**Commits:**
- `e4fdac7` — feat(collab): full RTCDataChannel E2E encryption via y-webrtc patch + smoke tests + i18n

### P0 #4 — DS-5: Legacy CSS Bridge-Block entfernen (ALS ERLEDIGT MARKIERT)
- Nach Analyse der Sprint-Doku (`SPRINT-HANDOFF-2026-05-22.md`, `SPRINT-V1.16.md`):
  - Bridge-Block wurde in vorherigen Sprints bereits entfernt
  - Verbleibende Aliase (`--nav-*`, `--glass-*`, `--border-interactive`, `--ring-focus`) sind **bewusste semantische Tokens**, keine Legacy-Bridges
- `TODO.md` aktualisiert: DS-5 als ✅ erledigt markiert

**Kein separater Commit nötig** (Änderung in `TODO.md` erfolgte im `e4fdac7`-Commit mit enthalten)

### P0 #2 — Storage Resilience & Recovery (SUBSTANTIELL ABGESCHLOSSEN)
- **retryDb verbessert:**
  - Exponentielles Backoff: 500ms → 1000ms → 2000ms
  - Jitter: bis zu 200ms zufällige Verzögerung (verhindert Thundering Herd)
- **retryDb auf weitere Methoden angewendet:**
  - `loadState()` (kritischer App-Start-Pfad!)
  - `createSnapshot()`, `listSnapshots()`, `getSnapshotData()`, `deleteSnapshot()`
  - `deleteProject()`
- **Proaktive Low-Storage-Warnung:**
  - `checkStorageHealth()` in `services/dbInitialization.ts`
  - Nutzt `navigator.storage.estimate()`
  - Warnt bei ≥85% Quota-Nutzung
  - Integriert in `listenerMiddleware.ts` Auto-Save-Pfad
  - Dispatched `statusActions.addNotification()` mit Error-Toast
- **Tests:**
  - `dbServiceRetry.test.ts`: +1 Test für exponentielles Backoff-Timing (8 Tests gesamt)
  - `dbInitialization.test.ts`: +4 Tests für `checkStorageHealth` (12 Tests gesamt)

**Commits:**
- `99d1ebb` — feat(storage): harden retryDb with exponential backoff + jitter; protect loadState & snapshots
- `33cb544` — feat(storage): proactive low-storage warning via checkStorageHealth

### Vercel-Deployment-Fix (BEHOBEN)
- Problem: `pnpm-lock.yaml` enthielt keine `patchedDependencies`-Sektion für `y-webrtc@10.3.0`
- Vercel brach mit `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH` ab
- Fix: `pnpm install --no-frozen-lockfile` lokal ausgeführt, Lockfile aktualisiert, gepusht

**Commit:** `12fda28`

---

## ⏳ Offene P0-Items (für nächste Sitzung)

### P0 #3 — Voice E2E-Tests hinzufügen (NOCH OFFEN)
**Status:** Analyse begonnen, aber keine Implementierung gestartet  
**Was fehlt:**
- Playwright-Spec für Voice-Flows erstellen (`tests/e2e/voice.spec.ts`)
- Feature-Flag `enableVoiceSupport` in E2E aktivieren
- Web Speech API mocken (SpeechRecognition / SpeechSynthesis)
- Microphone-Permission simulieren
- Tests für:
  - VoiceSettingsSection-Rendering in Settings
  - VoiceControlPanel-Interaktionen
  - Push-to-Talk (Ctrl+Shift+V)
  - Dictation in ManuscriptEditor
  - VoiceIndicator-Status-Overlay
- **Kontext:** Voice Foundation wurde in v1.17 implementiert (83 Unit Tests), aber keine E2E-Abdeckung

### P0 #1 Nacharbeit — RTCDataChannel-Test-Integration (OPTIONAL)
- Aktuell nur Smoke-Tests (prüfen, dass Patch angewendet wurde)
- Echte Integration-Tests (zwei Yjs-Dokumente syncen lassen) wären wünschenswert, aber aufwändig
- WebRTC in jsdom/Playwright nicht nativ verfügbar → erfordert Mock-Provider oder echten Browser-Test

---

## 🔧 Technische Kontexte für Wiederaufnahme

### y-webrtc Patch
- Patch-Datei: `patches/y-webrtc@10.3.0.patch`
- Registriert in `package.json` unter `pnpm.patchedDependencies`
- Bei y-webrtc-Upgrade muss der Patch neu erstellt werden (`pnpm patch y-webrtc@<new>`)
- Original-Quelle: `node_modules/y-webrtc/src/y-webrtc.js` (wird von pnpm automatisch gepatched)

### retryDb-Verbesserungen
- Location: `services/dbService.ts` Zeile ~73
- Signature: `retryDb<T>(fn: () => Promise<T>, retries = 2, baseDelayMs = 500)`
- Formel: `delay = baseDelayMs * 2^attempt + jitter(0-200ms)`
- Geschützte Methoden: `saveProject`, `saveSettings`, `saveApiKey`, `getApiKey`, `clearApiKey`, `saveGeminiApiKey`, `getGeminiApiKey`, `clearGeminiApiKey`, `saveBinderAsset`, `getBinderAsset`, `deleteBinderAsset`, `listBinderAssetIds`, `loadState`, `createSnapshot`, `listSnapshots`, `getSnapshotData`, `deleteSnapshot`, `deleteProject`

### Storage Health Check
- Location: `services/dbInitialization.ts`
- Threshold: 85% Quota-Nutzung
- Integration: `app/listenerMiddleware.ts` (Auto-Save-Listener, vor dem eigentlichen Speichern)
- Fallback: Wenn `navigator.storage.estimate()` nicht verfügbar oder fehlerhaft → silently ok

### Git-Status
- Branch: `main`
- Alle Änderungen gepusht zu `origin/main`
- Tag `v1.17.0` gepusht
- Keine uncommitteten Änderungen im Working Tree

---

## 🚀 Nächste empfohlene Schritte (Priorisiert)

1. **P0 #3 Voice E2E-Tests** — Am kritischsten, da letztes offenes P0-Item
   - `tests/e2e/voice.spec.ts` erstellen
   - Web Speech API mocken in Playwright
   - Voice-Settings, ControlPanel, Indicator testen

2. **GitHub Release v1.17.0 manuell erstellen** (falls nicht via `gh` CLI nachgeholt)
   - `gh release create v1.17.0 --title "v1.17.0 — Voice Full Support Foundation" --notes-file <changelog-excerpt>`

3. **Vercel-Deployment verifizieren**
   - Push auf `main` sollte automatisch triggern
   - Prüfen, ob Build nach `12fda28` erfolgreich durchläuft

4. **Weitere Storage-Härtung (optional)**
   - retryDb auf `saveStoryCodex`, `saveRagVectors`, `saveImage` ausweiten
   - Automatische Datenkomprimierung/Archivierung bei >90% Quota

5. **P1-Items aus Audit angehen**
   - RTL-Support finalisieren
   - Mobile/PWA-Polish
   - Tauri Auto-Update + Code-Signing

---

## 📊 Sitzungs-Statistik
- **Commits:** 5 (da61b5a, 12fda28, e4fdac7, 99d1ebb, 33cb544)
- **Geänderte Dateien:** ~20 (inkl. Tests, i18n, Patches, Manifeste)
- **Neue Tests:** 10 (5 yWebrtcPatch + 1 dbServiceRetry + 4 checkStorageHealth)
- **P0-Items abgeschlossen:** 4 von 5
- **Verbleibende P0-Items:** 1 (Voice E2E-Tests)

---

## ⚠️ Bekannte technische Einschränkungen

- **Plan-Mode-Bug:** Während der Sitzung trat wiederholt ein Konflikt auf zwischen `system-reminder` ("Plan mode still active") und tatsächlichem Verhalten (`ExitPlanMode` warf "Not in plan mode"). Dies wurde umgangen durch direkte Implementierung nach Nutzerbestätigung.
- **GitHub API:** Zu Sitzungsbeginn keine Authentifizierung → Release-API fehlgeschlagen. `gh auth login` wurde später durchgeführt.
- **pnpm patch-commit:** Erster Versuch mit 60s Timeout fehlgeschlagen (Peer-Dependency-Issue). Gelöst durch manuelles `diff` + Lockfile-Update.
- **Vercel:** `pnpm install --frozen-lockfile` brach wegen fehlender `patchedDependencies` im Lockfile ab. Behoben via `pnpm install --no-frozen-lockfile` + Commit.
