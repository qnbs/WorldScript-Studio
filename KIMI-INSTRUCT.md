# Kimi Code — Sitzungsübergreifende Instruktionen

> Diese Datei gilt für **alle Sitzungen** mit Kimi Code CLI in diesem Repository.
> Sie ergänzt `AGENTS.md` und hat für Kimi-spezifische Workflows Vorrang.

---

## 1. Sprache & Kommunikation

- Antworte dem Nutzer auf **Deutsch**, es sei denn, er fordert explizit Englisch.
- Halte Erklärungen kurz, faktenbasiert und lösungsorientiert.
- Vermeide Floskeln; konzentriere dich auf **was getan wurde, was noch offen ist und was als Nächstes nötig ist**.

---

## 2. Grundsatz: CI-Cloud-First, keine schwere lokale Last

Dieses Projekt läuft auf Low-End-Hardware. Beachte strikt:

- **Niemals** lokal ausführen:
  - `pnpm run test:coverage` (CI-only)
  - `pnpm run test:e2e`
  - `pnpm run mutation`
  - `pnpm run lighthouse`
  - `pnpm run build-storybook` / `test:storybook`
- **Lokale Quick-Tier-Checks** (immer vor einem Push):
  ```bash
  pnpm run lint && pnpm run typecheck && pnpm run i18n:check
  ```
- **Selektive Unit-Tests** nur für direkt betroffene Dateien:
  ```bash
  pnpm exec vitest run tests/unit/<pfad>.test.ts[x]
  ```
- **Coverage-Metriken** stets aus den Cloud-CI-Artifacts holen (`coverage-report`), nicht lokal berechnen.
- Führe Builds/Testläufe **sequentiell** aus; parallele Prozesse vermeiden.

---

## 3. CodeAnt AI PR-Review-Correction-Loop

Dieser Workflow ist die Standardvorgehensweise, wenn der Nutzer um Behebung von CodeAnt-Kommentaren bittet.

### 3.1 Threads abrufen

Nutze **GitHub GraphQL** über `gh api graphql`, um den Status aller Review-Threads zu sehen:

```bash
gh api graphql -f query='
query($owner: String!, $repo: String!, $pr: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $pr) {
      reviewThreads(first: 100) {
        nodes {
          id
          isResolved
          comments(first: 1) {
            nodes {
              id
              path
              line
              body
            }
          }
        }
      }
    }
  }
}' -F owner=qnbs -F repo=WorldScript-Studio -F pr=<NUMMER>
```

Speichere die ungelösten Thread-IDs in eine Datei, z. B.:

```bash
jq -r '... select(.isResolved == false) | .id' /tmp/pr_threads.json > /tmp/unresolved_threads.txt
```

### 3.2 Kommentare validieren & fixen

- Lies den CodeAnt-Kommentar und den zugehörigen Code.
- Entscheide, ob der Hinweis korrekt ist.
- Wenn ja: implementiere eine **minimale, lokalisierte Lösung**.
- Wenn nein: dokumentiere kurz im Reply, warum der Hinweis nicht zutrifft.
- Vermeide Scope-Creep; adressiere nicht gleichzeitig unabhängige Features.

### 3.3 Lokale Qualitätsprüfung

Nach jeder Änderung:

```bash
pnpm exec biome check --error-on-warnings <geänderte-dateien>
pnpm exec tsgo --project tsconfig.tsgo.json --noEmit
pnpm run i18n:check
pnpm exec vitest run <betroffene-testdateien>
```

- Lint/Format-Fehler vor dem Commit beheben (`biome check --write ...`).
- TypeScript-Fehler sofort beheben.
- i18n-Keys bei neuem UI-Text zu **allen 11 Locales** hinzufügen und Bundles neu bauen.

### 3.4 Commit & Push

- Commit-Nachricht im Conventional-Commits-Stil.
- Pre-Commit-Hook (`lint-staged` + Biome) läuft automatisch.
- Push auf den Feature-Branch.

```bash
git add -A
git commit -m "fix(scope): beschreibung"
git push origin <branch>
```

**Keine git mutations außerhalb dieses Workflows ohne explizite Nutzerbestätigung.**

### 3.5 Threads beantworten & schließen

Schreibe in **jeden** behandelten Thread einen kurzen Reply und markiere ihn als resolved.

Reply-Mutation (pro Batch max. ca. 5 Aliase, um Resource-Limits zu vermeiden):

```graphql
mutation {
  reply1: addPullRequestReviewThreadReply(
    input: {
      pullRequestReviewThreadId: "PRRT_...",
      body: "Fixed in [`<SHORT_SHA>`](https://github.com/qnbs/WorldScript-Studio/pull/<NUM>/commits/<FULL_SHA>). Lint, typecheck, i18n parity and targeted Vitest suites pass locally."
    }
  ) { comment { id } }
}
```

Thread resolven:

```graphql
mutation {
  resolve1: resolveReviewThread(input: { threadId: "PRRT_..." }) {
    thread { id isResolved }
  }
}
```

Wiederhole für alle 18+ Threads in Batches.

### 3.6 Re-Review triggern

Nach dem Schließen aller Threads:

```bash
gh pr comment <NUMMER> --body '@codeant-ai review'
```

Danach keine Live-Watch-Ausgabe der CI; Ergebnisse später aus den Cloud-Artifacts oder der GitHub-UI prüfen.

### 3.7 Iron Rule — Loop bis Ruhe (Abbruchbedingung)

**Der Correction-Loop endet NICHT nach einem Durchgang.** Ein Push, der Kommentare behebt, triggert eine **frische** CodeAnt-Review, die regelmäßig **neue** Findings erzeugt (eine „Welle") — oft als direkte Folge der gerade gemachten Fixes. Jede Welle wird exakt wie die erste behandelt (§3.1 → §3.6).

> **Abbruchbedingung (BEIDES muss gelten):**
> 1. Eine frisch getriggerte Review liefert **0 neue Inline-Kommentare**, **und**
> 2. **0** Review-Threads sind unresolved.
>
> Solange nicht beides erfüllt ist: **weiter iterieren.** Niemals die PR als fertig erklären, während noch Kommentare eintreffen oder ein Thread offen ist.

### 3.8 Suppression-Ratchet — niemals neue `biome-ignore`

CI erzwingt einen **Suppression-Ratchet** (`scripts/check-suppressions.mjs`, Baseline-Zähler). Ein neues `// biome-ignore` **erhöht den Zähler und lässt das Quality-Gate scheitern**. Daher: ein Lint-Finding **nie** durch Suppression „lösen" — sauber refaktorieren, bis die Regel ehrlich grün ist. Nach jeder Änderung `node scripts/check-suppressions.mjs` → muss `[suppressions] OK` ausgeben.

### 3.9 Kanonische Prozedur

Die vollständige, agenten-übergreifende Referenz dieses Loops liegt in **`docs/CODEANT-REVIEW-LOOP.md`** (Single Source of Truth). Bei Workflow-/Tool-Änderungen dort UND hier aktualisieren.

---

## 4. Coverage-Metriken aus Cloud-CI holen

1. Letzten erfolgreichen Run finden:
   ```bash
   gh run list --workflow=ci.yml --limit 5 --json databaseId,status,conclusion,headSha
   ```
2. Artifacts auflisten:
   ```bash
   gh api repos/qnbs/WorldScript-Studio/actions/runs/<RUN_ID>/artifacts
   ```
3. `coverage-report` herunterladen:
   ```bash
   rm -rf /tmp/coverage
   gh run download <RUN_ID> -n coverage-report -D /tmp/coverage
   ```
4. Gesamtmetriken aus `/tmp/coverage/index.html` auslesen:
   ```bash
   grep -oE '[0-9]+\.[0-9]+%|Statements|Branches|Functions|Lines' /tmp/coverage/index.html
   ```
5. Vergleiche mit `vitest.config.ts`-Thresholds.

---

## 5. Wichtige Projektregeln (Reminder)

- Keine `dark:`-Tailwind-Prefixe; Theming läuft über Body-Klassen + CSS-Custom-Properties.
- `useImportType` beachten; kein `any` verwenden.
- UI-Text immer über `useTranslation()` / i18n-Keys.
- Cloud-AI-Calls immer über `assertCloudAiAllowed(...)` gaten.
- Service Worker / CSP beachten bei neuen externen Hosts.
- Keine Secrets in Code, `.env` oder Build-Outputs.

---

## 6. Datei aktuell halten

Wenn sich dieser Workflow oder die verwendeten Tools ändern, aktualisiere diese Datei sofort, damit sie sitzungsübergreifend korrekt bleibt.
