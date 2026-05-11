# Accessibility (StoryCraft Studio)

Kurzleitfaden für Maintainer: wo Barrierefreiheit in der App verankert ist und wie wir sie prüfen.

## Architektur

- **Live-Regionen:** `LiveRegionProvider` / `useAnnounce()` in [`contexts/LiveRegionContext.tsx`](../contexts/LiveRegionContext.tsx). View-Wechsel werden mit übersetztem Seitentitel angesagt (nicht mit internen View-Keys).
- **Fokus:** `useFocusTrap()` in [`hooks/useFocusTrap.ts`](../hooks/useFocusTrap.ts) — genutzt von Modal und Command Palette.
- **Einstellungen:** Hub unter Settings → Accessibility inkl. Presets und `liveRegionVerbosity`; Persistenz über Redux, Validierung mit Zod in [`features/settings/accessibilitySchema.ts`](../features/settings/accessibilitySchema.ts).

## Manuelle Checks

- Tastatur: Skip-Link (`App`), Command Palette (⌘/Strg+K), alle primären Dialoge (Tab bleibt gefangen, ESC schließt wo vorgesehen).
- Screenreader-Stichprobe: Navigation zwischen Views, Palette öffnen/schließen, Accessibility-Hub in den Einstellungen.

## Automatisierte Checks

- **Playwright:** [`tests/e2e/a11y.spec.ts`](../tests/e2e/a11y.spec.ts) — axe-core, schwere Verstöße (critical/serious) müssen fehlen; Farbkontrast-Regel ist bewusst deaktiviert (Designtokens werden separat beobachtet — bei Bedarf gezielt in Storybook **addon-a11y** oder ein lokaler axe-Lauf mit aktivierter `color-contrast`-Regel auf Einzelscreens).
- **Lighthouse CI:** [`.lighthouserc.cjs`](../.lighthouserc.cjs) — Accessibility-Kategorie als warn mit Mindest-Score (mobile Preview-URL).
- **Storybook:** Dev-Dependency `@storybook/addon-a11y` — nach `pnpm run storybook` die A11y-Registerkarte nutzen.

## i18n

Alle neuen nutzersichtbaren A11y-Texte liegen unter `locales/*/…` und werden per `pnpm run i18n:check` / Bundle-Build mit `public/locales/` synchronisiert.
