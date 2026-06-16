# Contributing to WorldScript Studio

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](https://www.contributor-covenant.org/version/2/1/code_of_conduct/).

## How to Contribute

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/amazing-feature`)
3. Make your changes
4. Run the local CI: `pnpm run lint && pnpm run typecheck && pnpm run i18n:check`
5. Commit with Conventional Commits format
6. Push and open a Pull Request

## Development Setup

```bash
pnpm install
pnpm run dev
```

See [`docs/CI.md`](../docs/CI.md) for full CI documentation.

## Security

See [`SECURITY.md`](../SECURITY.md) for vulnerability reporting.