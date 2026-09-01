# WorldScript Studio — Session Handoff (Claude → Codex CLI)

**Captured UTC:** 2026-08-28, ca. 12:45. **Grund:** Claude-Session-Wochenlimit steht kurz bevor.
**Worktree:** `/home/pc/WorldScript-Studio/.worktrees/main` (NICHT das Worktree wechseln — historischer
Root ist auf Branch `h1-d-intel-qualification`, weitere Worktrees `release-v1282`, `scenario-465`
existieren, NICHT anfassen). Repo: `qnbs/WorldScript-Studio`.

## 1. Was gerade passiert ist (Kontext für Codex)

Zwei-PR-Auftrag: **PR A** (Review-Workflow-Doku, CodeRabbit/CodeAnt-Semantik) — **bereits gemergt**
(#538, `main` = `ca2f364d43a052c7cba273523fd3a481f427d2cd`). **PR B** (Graphify+CodeGraph
Dual-Graph-Tooling-Härtung) — **offen als PR #539**, aktueller Branch `chore/dual-graph-solo-local-optimization`,
aktueller HEAD `b1de85b1ec8b694b26e8ba702bc728b3fb1ed61c`. Beide PRs liefen mit sehr vielen
Review-Wellen (CodeAnt, CodeRabbit, chatgpt-codex-connector) — die daraus gehärteten Regeln stehen
jetzt in `docs/PR-CI-MERGE-WORKFLOW.md` / `docs/CODEANT-REVIEW-LOOP.md` / `docs/DEEPSOURCE-REVIEW-LOOP.md`
(**vor dem Weiterarbeiten lesen** — evidenzbasierte CodeRabbit-Trigger-Semantik, Drei-Kanal-Modell mit
exhaustiver Pagination, fail-closed Stacked-PR-Regel, `--match-head-commit`).

## 2. Akuter Blocker — SOFORT nächster Schritt

PR #539 scheitert am **required** `PR Size Governance` Check (feeds `✅ CI Success` Aggregator):
`26 files, 6009 meaningful lines, 4 commits — limit ≤30 files / ≤3000 lines / ≤15 commits`. Überschreitung
kommt fast komplett aus dem Diff der zwei neu generierten Report-Dateien (`graphify-out/GRAPH_REPORT.md`
4527→169 Zeilen, `.codegraph/CODEGRAPH_REPORT.md` neu generiert) — nicht aus schwer review-barer Logik.

**User-Entscheidung (bereits getroffen):** Einmalige Size-Limit-Ausnahme anfragen (NICHT splitten, NICHT
Reports weiter kürzen). Das erfordert eine **maintainer-seitige** Aktion (User selbst, GitHub-Admin) —
Codex/Claude kann das nicht selbst autorisieren. Nächster Schritt: mit dem User klären, wie die Ausnahme
technisch erfolgt (z. B. `check-pr-size.mjs`/Governance-Config anpassen mit expliziter Begründung im Commit,
oder ein Admin-Merge nur für diesen einen Fall mit frischer expliziter Autorisierung). **Kein `--admin`
ohne diese frische, explizite Freigabe.**

## 3. CI-Stand auf PR #539 (letzter bekannter Stand)

Grün: CodeAnt (alle 5), Amazon Q, CodeQL, Security Audit, semgrep, Verified Signatures, GitGuardian,
Socket (beide), Workflow Policy Gate. **Rot/blockierend:** PR Size Governance (s. o.). Quality Gate
Node 22/24 war zuletzt noch pending. **Review-Threads auf #539 wurden noch NICHT geprüft** — sobald CI
grün ist (nach Size-Gate-Lösung), den vollen Drei-Kanal-Check fahren (siehe gehärtete Doku oben) BEVOR
gemergt wird.

## 4. Was in PR B technisch gebaut wurde (kurz)

- `config/graph-tools-versions.json` — Versions-Policy (graphifyy 0.9.51, codegraph 1.6.0, beide
  `controlled-upgrade`, tatsächlich lokal installiert).
- `scripts/graphSourceFingerprint.mjs` — worktree-aware Fingerprint (kein Commit-SHA, keine
  git-ls-tree-Falle), `checkCleanState()` für `DIRTY_UNTRACKED_INPUT`-Gate.
- `scripts/graphs-cli.mjs` — Kommando-Interface `bootstrap|doctor|status|update|report|refresh`
  (ersetzt `dual-graph-update.mjs`, das früher Fehler verschluckt hat).
- `scripts/codegraph-report.mjs` (neu geschrieben) + `scripts/graphify-report.mjs` (neu) — kompakte,
  deterministische, fingerprint-gated Reports statt der alten kaputten/fremden/riesigen Reports.
- Beide committeten Reports (`graphify-out/GRAPH_REPORT.md`, `.codegraph/CODEGRAPH_REPORT.md`) sind
  bereits neu generiert, fingerprint-verifiziert, Determinismus getestet (Regenerierung ohne
  Source-Änderung → byte-identisch).
- Unit-Tests: `tests/unit/scripts/graphSourceFingerprint.test.ts` (10) +
  `tests/unit/scripts/codegraphReport.test.ts` (7) — alle grün.

## 5. Bekannte Stolperfallen (nicht erneut debuggen)

- **`.codegraph/.gitignore` taucht immer wieder als `??` auf** — wird von `codegraph init`/manchen
  Befehlen neu erzeugt, un-ignored sich selbst (`!.gitignore`), würde sich sonst selbst tracken. Vor
  jedem `git add`/Commit prüfen und `rm -f .codegraph/.gitignore` falls vorhanden — NIE `git add -A`
  blind verwenden, immer explizite Pfade stagen.
- **`graphify-report.mjs` überschreibt denselben Pfad, den graphify selbst nativ beschreibt.** Bei
  "no topology changes" schreibt graphify nichts — das Skript benennt die vorige kompakte Version vorher
  um und stellt sie in diesem Fall unverändert wieder her (bereits gefixt, s. Commits `5ac03296`/`e2eae67e`).
- Dieses Repo hat `delete_branch_on_merge=true` (verifiziert) — `--delete-branch` beim Merge ist bei
  0 abhängigen offenen PRs unkritisch; bei >0 abhängigen PRs NICHT mergen, erst umbasieren (siehe
  gehärtete Doku, fail-closed Regel).
- `pnpm run ci:prepush` ist das lokale Pflicht-Gate (NICHT `pnpm run lint`/`typecheck` einzeln erwarten
  — die laufen separat via `pnpm run lint` / `pnpm run typecheck:single`, falls nötig).
- Nach jedem `package.json`-Edit vor Tests: `node scripts/dependency-state.mjs reconcile` (NIEMALS
  bare `pnpm install`), sonst `ERR_PNPM_VERIFY_DEPS_BEFORE_RUN`.
- README-Testmetriken müssen nach neuen Testdateien synchronisiert werden:
  `node scripts/sync-readme-metrics.mjs`.

## 6. Nach erfolgreichem Merge von PR #539 (Rest des Master-Auftrags)

1. `git fetch origin main --prune && git switch main && git pull --ff-only` — Invarianten neu prüfen
   (`core.bare=false`, `hooksPath` leer, Worktree-Topologie unverändert).
2. Post-Merge-Funktionsnachweis: `pnpm run graphs:status` muss `FRESH` für beide Reports zeigen,
   `git status --short` sauber.
3. Konsolidierten Abschlussbericht liefern (kanonische SHAs, Persistenz-Matrix, Funktionsnachweis) —
   siehe ursprünglicher Master-Prompt §26 (Plan-Datei: `~/.claude/plans/worldscript-studio-enumerated-dragonfly.md`).

## 7. Harte Regeln (gelten für jeden Agenten hier)

- Sequenziell: **ein** schwerer Shell-Befehl gleichzeitig (2 Kerne, ~3.7 GB RAM, oft <500 MB frei).
- Nie `git config` schreiben, nie Worktrees löschen/verschieben außer explizit angefragt.
- Nie direkt auf `main` committen — immer Feature-Branch + PR.
- Zero Tolerance bei jedem `FAILURE`-Status (required oder advisory) — nie ignorieren/raten.
- Keine `--admin`/Protection-Bypass ohne frische, explizite, fallspezifische Freigabe des Users.
