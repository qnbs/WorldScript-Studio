# ADR 0007 — Plugin Sandbox Model

## Status

Accepted — implemented in v1.22.1

## Context

The Plugin System Beta (feature flag `enablePluginSystem`) executes third-party plugin code inside a Web Worker (`workers/plugin.worker.ts`). The initial implementation serialized the API object with `JSON.stringify`, turning every function into `null`, and evaluated the plugin code in the Worker's global scope. This allowed sandbox escape via `fetch`, `indexedDB`, `WebSocket`, `self`, `globalThis`, etc.

We needed a pragmatic fix that:

1. Closes the most common sandbox-escape vectors immediately.
2. Keeps the Beta architecture lightweight and testable in Vitest.
3. Preserves a path to stronger isolation (iframe, ShadowRealm) in Phase 3.

## Decision

Adopt **Option A: Function-Scope Sandbox in the Worker**.

- Plugin code is passed as a string and wrapped in `new Function(...)`.
- All dangerous globals (`fetch`, `XMLHttpRequest`, `WebSocket`, `indexedDB`, `IDBFactory`, `navigator`, `location`, `self`, `globalThis`, `window`, `top`, `parent`) are shadowed parameters set to `undefined`.
- The worker receives a read-only serializable project snapshot (`projectTitle`, `sceneTitles`) and the plugin's declared `permissions`.
- The plugin's `run(api)` callback can only collect serializable side effects (`appendToCurrentScene`, `log`), which the main thread applies after verifying permissions.
- Async APIs (`generateText`, `storageRead`, `storageWrite`) inside the worker sandbox intentionally throw until a proxy-to-main design is implemented.

## Consequences

### Positive

- Sandbox escape via shadowed globals is blocked.
- Plugin code can no longer access the network, storage, or Worker global scope directly.
- Side-effect model keeps Redux state mutation on the main thread.
- Fully unit-testable; 13 worker tests cover escape attempts, payload validation, permission gating, and abort handling.

### Negative / Trade-offs

- This is **not** process-level or iframe isolation. A determined plugin can still perform CPU exhaustion or memory bombs inside the worker.
- Async plugin features require a future proxy-to-main design.
- Timeout/abort does not yet forcibly interrupt in-flight dynamic `import()` or synchronous infinite loops.

## Alternatives Considered

- **Option B: iframe with `sandbox="allow-scripts"`** — higher isolation, but requires a `postMessage` bridge between iframe, Worker, and main thread. Rejected for v1.22.1 to limit architectural churn; kept as Phase 3 candidate.

## Related Files

- `workers/plugin.worker.ts`
- `services/pluginRegistry.ts`
- `packages/worker-bus/src/schemas.ts`
- `tests/unit/workers/plugin.worker.test.ts`
- `tests/unit/plugins/pluginRegistryLoad.test.ts`
