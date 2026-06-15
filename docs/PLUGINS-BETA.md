# Plugin System (Beta)

**Status:** Beta / Opt-in (v1.22.0)  
**Feature Flag:** `enablePluginSystem` (off by default)

## Overview

The WorldScript Studio Plugin System allows extending the application with custom functionality through a secure, sandboxed execution model. Plugins run in an isolated Web Worker context and interact with the application through a permission-gated API.

## Security Model

### Worker Isolation
- All plugin code executes in `workers/plugin.worker.ts` (Web Worker)
- Plugins cannot access the main thread directly
- No direct access to Redux store, DOM, or browser APIs
- Plugin code runs inside a function-scope sandbox: dangerous globals (`fetch`, `indexedDB`, `WebSocket`, `self`, `globalThis`, `Function`, `eval`, `WebAssembly`, etc.) are shadowed or neutered. Runtime guards also override `Function.prototype.constructor` (and async/generator variants) so a plugin cannot recover the real global object via `(function(){}).constructor`. This closes the most common sandbox-escape vectors while keeping the architecture lightweight. It is **not** the same as process-level isolation; future releases may add iframe or ShadowRealm isolation (Phase 3).
- The worker does **not** receive live API objects. It gets a read-only project snapshot and returns serializable side effects (`appendToCurrentScene`, `log`) that the main thread applies after verifying permissions.

### Permission Gating
Plugins declare required permissions in their manifest. The registry enforces these at runtime:

| Permission | API Method | Description |
|------------|------------|-------------|
| `project.read` | `getProjectTitle()` | Read project metadata |
| `scene.read` | `getSceneTitles()` | Read scene titles |
| `scene.write` | `appendToCurrentScene()` | Append text to active scene |
| `storage.read` | `storageRead()` | Read plugin-namespaced IDB values |
| `storage.write` | `storageWrite()` | Write plugin-namespaced IDB values |
| `ai.invoke` | `generateText()` | Generate text via AI provider |

### Execution Timeout
- Default timeout: 30 seconds
- A timeout `AbortSignal` is propagated into the worker task, but `import()` of dynamic URLs and long-running synchronous plugin loops are only partially abortable today. Endless synchronous loops can still block the worker until the task is forcibly cancelled by the WorkerBus timeout/circuit breaker.

### Telemetry
All plugin executions are logged to the structured logger:
- Plugin ID and execution duration
- Success/failure status
- Error messages (sanitized)
- No plugin data is sent to the cloud; telemetry is on-device only.

## API Reference

### PluginDescriptor
```typescript
interface PluginDescriptor {
  id: string;           // Unique plugin identifier
  version: string;        // Semantic version
  name: string;           // Display name
  type: 'command' | 'ai-tool' | 'local-ai-service';
  entrypoint: string;     // URL to plugin code
  permissions: PluginPermission[];
  description?: string;
}
```

### PluginSandboxedApi
```typescript
interface PluginSandboxedApi {
  getProjectTitle(): string;
  getSceneTitles(): string[];
  appendToCurrentScene(text: string): void;
  log(message: string): void;
  generateText(prompt: string, opts?: { maxTokens?: number }): Promise<string>;
  storageRead(key: string): Promise<unknown>;
  storageWrite(key: string, value: unknown): Promise<void>;
}
```

## Usage

### Registering a Plugin
```typescript
import { pluginRegistry } from '../services/pluginRegistry';

const myPlugin: PluginDescriptor = {
  id: 'my-plugin',
  version: '1.0.0',
  name: 'My Plugin',
  type: 'command',
  entrypoint: 'https://example.com/my-plugin.js',
  permissions: ['project.read', 'scene.write'],
};

pluginRegistry.register(myPlugin);
```

### Executing a Plugin
```typescript
// Synchronous execution (for plugins using only sync APIs)
const result = pluginRegistry.execute('my-plugin', (api) => {
  const title = api.getProjectTitle();
  api.log(`Project: ${title}`);
}, sandboxedApi);

// Async execution (for plugins using async APIs)
const result = await pluginRegistry.executeAsync('my-plugin', async (api) => {
  const text = await api.generateText('Continue the story');
  api.appendToCurrentScene(text);
}, sandboxedApi);

// Dynamic loading (fetches and executes plugin code)
const result = await pluginRegistry.loadPlugin(myPlugin, sandboxedApi);
```

## Reference Plugins

Two reference plugins are included in `services/plugins/`:

1. **wordCountOverlay.plugin.ts** - Logs project title and scene count
2. **sceneAppender.plugin.ts** - Appends scene breaks with run-count tracking

## Roadmap

- **v2.0:** Full plugin registry UI in Settings
- **v2.0:** Plugin marketplace integration
- **v2.0:** Hot-reloading during development
- **v2.0:** Plugin dependency management

## Known Limitations

- Plugin system must be explicitly enabled via feature flag
- Worker sandbox uses function-scope shadowing, not process or iframe isolation
- Async APIs (`generateText`, `storageRead`, `storageWrite`) inside the worker sandbox currently throw; asynchronous plugin features require a future proxy-to-main design
- Timeout/abort covers the WorkerBus task boundary but does not yet forcibly interrupt in-flight dynamic `import()` or synchronous infinite loops
- Side effects are limited to `appendToCurrentScene` and `log`; other mutations must be added explicitly on the main thread
- No plugin discovery mechanism (manual registration only)
- No plugin update mechanism
- Storage access is namespaced but not project-scoped

## Changelog

| Version | Change |
|---------|--------|
| v1.22.0 | Added telemetry logging, timeout enforcement, loadPlugin tests |
| v1.20.0 | Initial plugin system with worker isolation |