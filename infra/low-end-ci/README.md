# Low-End Local CI/CD — WorldScript Studio

**Variante:** act-first + Eco-Forgejo (kein Woodpecker, kein dauerlaufender Forgejo Actions Runner).

| Dokument | Inhalt |
|----------|--------|
| [INSTALL.md](INSTALL.md) | Vollständige Installation Ubuntu 20.04 |
| [DAILY-DRIVER.md](DAILY-DRIVER.md) | Checkliste, Aliase, Troubleshooting |

**Schnellstart nach Installation:**

```bash
./scripts/install-permissions.sh
./eval-template.sh
cp .actrc.example ~/.actrc
cp act.secrets.example ~/worldscript-ci/act.secrets && chmod 600 ~/worldscript-ci/act.secrets
cd ../../ && pnpm run ci:quick
```
