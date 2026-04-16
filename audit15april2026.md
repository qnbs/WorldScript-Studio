# StoryCraft Studio Repository Audit

**Datum:** 15. April 2026
**Repository:** StoryCraft-Studio
**Branch:** main

## 1. Executive Summary

StoryCraft Studio ist eine starke, moderne React/TypeScript-Anwendung mit gutem Architekturdesign, strenger TypeScript-Konfiguration und einer umfassenden CI/CD-Pipeline. Die größten Risiken liegen in der Desktop-Backend-Implementierung, der Persistenz-Schicht sowie in noch nicht vollständig abgedeckten Testpfaden und Konsolidierung von Dev/Prod-Logging.

### Stärken

- **Architektur:** Feature-sliced Design mit klaren Trennungen in `components/`, `hooks/`, `services/`, `features/`.
- **TypeScript-Qualität:** `strict: true`, `exactOptionalPropertyTypes: true`, `noImplicitAny: true`, `@typescript-eslint/no-explicit-any` wird als Fehler gesetzt.
- **PWA-Fähigkeiten:** Service Worker, Offline-Fallback und IndexedDB-Persistenz sind vorhanden.
- **Sicherheit:** AES-256-GCM-Verschlüsselung für Gemini API-Key in IndexedDB, Tauri CSP definiert, API-Key-Caching mit Hash-Invaladierung.
- **CI/CD:** Robuste Pipeline in `.github/workflows/ci.yml` mit Lint, Typecheck, Tests, Storybook und optionalem Tauri-Build.
- **Lokalisierung:** Vollständige i18n-Struktur mit 5 Sprachen und dedizierten Übersetzungsmodulen.

### Haupt-Risiken

- **Desktop-Security:** `services/fileSystemService.ts` speichert generische Provider-API-Keys als Klartext.
- **Persistenz-Mismatch:** `services/storageService.ts` verwendet `StorageBackend`, aber `dbService` implementiert das Interface nicht exakt.
- **Exception-Handling/Logging:** Viele `console.*`-Ausgaben sind verstreut und teilweise ohne Umgebungsfilter.
- **Testabdeckung:** Unit-Tests vorhanden, aber kritische Bereiche wie Desktop-Backend, PWA-Flow, Export-Import und Error Boundary fehlen.

---

## 2. Kritische Befunde (Priority: High/Critical)

### 2.1 Desktop-Backend speichert Provider-API-Keys unverschlüsselt

- **Datei:** `services/fileSystemService.ts`
- **Zeile:** ca. 218
- **Problem:** `saveApiKey(provider, apiKey)` legt `provider_key.txt` im App-Daten-Verzeichnis ab.
- **Auswirkung:** Bei Tauri-Installationen können Drittprozesse oder kompromittierte Geräte diese Keys auslesen.
- **Empfehlung:** Verschlüsselte Speicherung auch für generische Provider-Keys verwenden; mindestens denselben AES-GCM-Mechanismus wie `dbService`.

### 2.2 Typ-Inkompatibilität zwischen Storage-Backend und dbService

- **Datei:** `services/storageService.ts`
- **Zeile:** 47–69
- **Problem:** `StorageBackend`-Interface wird definiert, aber `dbService` bietet unterschiedliche Methodensignaturen und Speicherformate.
- **Auswirkung:** Laufzeit-Adapterlogik birgt Fehlerpotenzial und verhindert klare Typintegration.
- **Empfehlung:** Refactor `storageService` in einen echten Adapter, der `StorageBackend` implementiert, oder extrahiere `dbService`-Spezialmethoden in ein Interface, das alle Backend-Implementierungen teilen.

### 2.3 `AUTO_SNAPSHOT_INTERVAL` stimmt nicht mit Kommentar überein

- **Datei:** `services/dbService.ts`
- **Zeile:** 102
- **Problem:** `AUTO_SNAPSHOT_INTERVAL = 30 * 1000` wird als 30 Sekunden deklariert, Kommentar sagt jedoch „War: 30 Minuten“.
- **Auswirkung:** Unklarheit bei Persistenz- und Snapshot-Timings; möglicher Performance-/Speicherbedarf.
- **Empfehlung:** Entweder Absicht klar dokumentieren oder auf `30 * 60 * 1000` umstellen.

### 2.4 Fehlende Produktions-Logging-Kontrolle

- **Dateien:** `services/storageService.ts` (Zeile 63, 65, 69), `app/store.ts` (Zeile 39, 41), `components/ApiKeySection.tsx`, `register-sw.ts`, `src-tauri`-Bereich
- **Problem:** Dev-Logs und Fehlerausgaben sind oft verstreut und nicht zentralisiert.
- **Auswirkung:** Sicherheits- bzw. Informationsleck bei produktivem Betrieb, inkonsistente Fehlerverfolgung.
- **Empfehlung:** Ein einfaches `logger`-Utility einführen und `console.*` durch gezielte, umgebungsabhängige Ausgaben ersetzen.

### 2.5 `DECRYPT_FAILED` als API-Key-Sentinel

- **Datei:** `services/dbService.ts`
- **Zeile:** 170, 253
- **Problem:** Die Funktion `getGeminiApiKey()` und `getApiKey()` liefert bei Entschlüsselungsproblemen den String `'DECRYPT_FAILED'`.
- **Auswirkung:** Dieser Sonderwert kann übersehen werden und sich wie ein echter Schlüssel verhalten.
- **Empfehlung:** Stattdessen `null` zurückgeben und Fehlerzustände explizit separat behandeln.

---

## 3. Hohe Priorität (Priority: Medium/High)

### 3.1 Unvollständige E2E-Abdeckung

- **Ordner:** `tests/e2e/`
- **Beobachtung:** E2E-Ordner existiert, aber Audit kann keine primären Flows dafür bestätigen.
- **Empfehlung:** Schreibe E2E-Szenarien für:
  - Projekt erstellen + speichern
  - API-Key-Konfiguration + KI-Generierung
  - Export/Import
  - Tauri-Desktop-Build-Passage

### 3.3 Storage-Backend-Dynamik kann Laufzeitfehler verursachen

- **Datei:** `services/storageService.ts`
- **Zeilen:** 45–70, 135–150
- **Problem:** `initializeBackend()` wird asynchron gestartet, aber `StorageManager` kann Methoden früher verwenden.
- **Empfehlung:** Backend-Initialisierung zwingend in `constructor()` oder vor erster Nutzung abschließen; kein nur implizites `console.log`-Fallback.

### 3.4 Verstreute `console.*`-Statements in Service-Dateien

- **Dateien:** `services/geminiService.ts`, `services/dbService.ts`, `services/fileSystemService.ts`, `hooks/useWriterView.ts`
- **Empfehlung:** `logger.warn/error/debug` anstelle von `console.*` nutzen; produktive Umgebungen filtern.

### 3.5 Persistenz-Validierung & Auto-Save

- **Datei:** `app/listenerMiddleware.ts`
- **Stärke:** Gute Guard-Logik gegen fehlerhafte `present.data` und historienreiche Speicherobjekte.
- **Risiko:** Wenn das Redux-Undo-Format bei `project.present` geändert wird, ist der Auto-Save-Pfad empfindlich.
- **Empfehlung:** Ein dediziertes `serializeProjectForSave()`-Utility schreiben, das Redux-Undo- und Flat-State sauber normalisiert.

---

## 4. Mittlere Priorität

### 4.1 Kein Performance-Budget / Bundle-Limits

- **Dateien:** `vite.config.ts`, `.github/workflows/ci.yml`
- **Empfehlung:** Füge Lighthouse- oder Bundlesize-Limits hinzu und prüfe Build-Größen für manuelle Chunks wie `konva`, `leaflet`, `react-force-graph-2d`.

### 4.2 Kein dediziertes Error Boundary pro View

- **Datei:** `components/ui/ErrorBoundary.tsx`
- **Problem:** Ein globales Boundary ist gut, aber per-View Boundaries würden UI-Isolation verbessern.
- **Empfehlung:** Fehlergrenzen um kritische Views wie `WriterView`, `Dashboard` und `ExportView` legen.

### 4.3 Fehlt ein Feature-Flag-System

- **Ordner:** `features/featureFlags`
- **Beobachtung:** FeatureFlags-Slice existiert, aber keine klare Runtime-Steuerung außerhalb Redux.
- **Empfehlung:** Ein `FeatureFlagToggle`-Panel oder `localStorage`-Fallback zur schnellen Aktivierung bauen.

### 4.4 Kein dedizierter Logging-Service

- **Problem:** Anwendungen verwenden `console.warn` und `console.error` direkt. Das ist in einer App mit API-Keys und PWA-Offline-Modus nicht ideal.
- **Empfehlung:** Minimaler Logging-Service mit Level-Steuerung und optionaler Telemetrie-Integration.

### 4.5 Statische Typen in `fileSystemService.ts`

- **Problem:** Viele `as unknown as ...`-Casts in Markdown-Konvertierung und `StoryProject`-Verarbeitung.
- **Empfehlung:** Streng typisierte Konverter schreiben oder `lib`-Parser verwenden.

---

## 5. Niedrige Priorität

### 5.1 Storybook-Erweiterung

- **Ordner:** `stories/`
- **Empfehlung:** Zusätzliche Stories für Modal, Toast, ErrorBoundary, Button-Varianten, PWA-Komponenten.

### 5.2 Dokumentation und Changelog

- **Status:** `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `AUDIT.md`, `ROADMAP.md` sind vorhanden.
- **Empfehlung:** Release-Prozess im Changelog standardisieren („Keep a Changelog“) und Audit-Empfehlungen im `ROADMAP.md` verlinken.

### 5.3 Veraltete Abhängigkeiten

- **Beobachtung:** `package.json` ist modern, verwendet aber `npm ci --legacy-peer-deps` in CI.
- **Empfehlung:** Abhängigkeiten in der nächsten Wartungsphase auf Peer-Dependency-Kompatibilität prüfen.

---

## 6. Konkrete Sofortige Korrektur-Vorschläge

1. **`services/fileSystemService.ts`**
   - Verschlüssele auch `saveApiKey(provider, apiKey)` sauber.
   - Verwende denselben AES-GCM-Prozess wie in `dbService.ts`.
   - Entferne den Kommentar „stored as plaintext“ oder passe ihn an.

2. **`services/storageService.ts`**
   - Schreibe `StorageManager` als echten Adapter.
   - Entferne die `| typeof dbService`-Union und mache beide Backends `StorageBackend`-kompatibel.

3. **`services/dbService.ts`**
   - Prüfe `AUTO_SNAPSHOT_INTERVAL` auf echte Anforderungen.
   - Ersetze `DECRYPT_FAILED` durch `null` und spezifizierten Fehlerstatus.
   - Reduziere direkte `console.warn`-/`console.error`-Ausgaben oder kanalisier sie.

4. **`app/listenerMiddleware.ts`**
   - Extrahiere das Speichern in eine Helper-Funktion.
   - Benutze `serializeProjectForSave(state.project)` anstelle von Inline-Casting.

5. **`services/geminiService.ts`**
   - Füge Jitter für 429-Retries hinzu.
   - Prüfe, ob `retry()` bei `generateText()` und `streamText()` tatsächlich alle 429-Kategorien abfängt.

6. **`tests/`**
   - Schreibe zusätzliche Tests für:
     - `services/fileSystemService.ts`
     - `storageService.ts` Adapter-Logik
     - `components/ui/ErrorBoundary.tsx`
     - `App.tsx` Hydration / Redux-Undo-Integration
     - `src-tauri/tauri.conf.json`-Sicherheitsregeln (Konfigurationsüberprüfung)

7. **`src-tauri/tauri.conf.json`**
   - Die CSP ist gut, achte darauf, dass nur wirklich notwendige `connect-src`-Domains zugelassen werden.
   - Prüfe, ob `build.frontendDist` korrekt auf `../build` statt `../dist` zeigen muss.

8. **Bereinigung**
   - Schaue nach weiteren veralteten Backend-Dateien oder Kommentaren im Repo.

---

## 7. Spezifische Dateien mit besonderer Aufmerksamkeit

- `services/fileSystemService.ts`
- `services/storageService.ts`
- `services/dbService.ts`
- `services/geminiService.ts`
- `app/listenerMiddleware.ts`
- `app/store.ts`
- `hooks/useCriticView.ts`
- `hooks/useConsistencyCheckerView.ts`
- `hooks/useWriterView.ts`
- `src-tauri/tauri.conf.json`
- `tests/unit/` und `tests/e2e/`

---

## 8. Empfehlung für nächsten Sprint

1. **Security Fixes zuerst:** Desktop-API-Key-Speicherung fixen und Storage-Adapter typisieren.
2. **Qualitätsverbesserung:** Consoles in Logging-Service überführen.
3. **Tests erweitern:** Zentrale Persistenz- und Desktop-Flows mit Unit/E2E abdecken.
4. **Cleanup:** Legacy-Backend und Kommentarinkonsistenzen entfernen.
5. **Performance:** Bundlesize-Checks und Snapshot-Interval auditieren.

Mit diesen Schritten ist StoryCraft Studio auf einem sehr guten Weg, die laufende Architektur durch eine saubere Persistenz-, Security- und Testbasis zu stabilisieren.

## 9. Nachbereitungs-Status

- Alle verbleibenden `console.log`/`console.warn`/`console.error`-Aufrufe im App-Code wurden durch das zentrale `services/logger.ts`-System oder einen lokalen Service-Worker-Logger ersetzt.
- `public/sw.js` wurde auf den internen `swLogger` umgestellt, damit Service-Worker-Logs ebenfalls konsistent behandelt werden.
- `features/featureFlags/featureFlagsSlice.ts` wurde korrigiert, um den ESLint-Fehler wegen leerem Objekt-Typ zu beseitigen.
- `tests/unit/featureFlagsSlice.test.ts` nutzt jetzt `import type` für reine Typimporte.
- ESLint und TypeScript prüfen nach den Änderungen erfolgreich.
