# Contributing to WorldScript Studio

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md).

## How to Contribute

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/amazing-feature`)
3. Make your changes
4. Run the local gate: `pnpm run ci:prepush` (see [`../CONTRIBUTING.md`](../CONTRIBUTING.md) for the full contributor guide)
5. Commit with Conventional Commits format
6. Push and open a Pull Request

## Development Setup

```bash
node scripts/dependency-state.mjs reconcile  # frozen-lockfile install — never a bare `pnpm install`
pnpm run dev
```

See [`docs/CI.md`](../docs/CI.md) for full CI documentation and [`../CONTRIBUTING.md`](../CONTRIBUTING.md) for the complete contributor guide.

## Security

See [`SECURITY.md`](SECURITY.md) for vulnerability reporting.