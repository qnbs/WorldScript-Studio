# Plugin System (Beta)

**Status:** Beta / Opt-in (v1.22.0)  
**Feature Flag:** `enablePluginSystem` (off by default)

## Overview

The StoryCraft Studio Plugin System allows extending the application with custom functionality through a secure, sandboxed execution model. Plugins run in an isolated Web Worker context and interact with the application through a permission-gated API.

## Security Model

### Worker Isolation
- All plugin code executes in `workers/plugin.worker.ts` (Web Worker)
- Plugins cannot access the main thread directly
- No direct access to Redux store, DOM, or browser APIs

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
- Plugins exceeding timeout are terminated
- Timeout is enforced in the worker context

### Telemetry
All plugin executions are logged to the structured logger:
- Plugin ID and execution duration
- Success/failure status
- Error messages (sanitized)

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
- No plugin discovery mechanism (manual registration only)
- No plugin update mechanism
- Storage access is namespaced but not project-scoped

## Changelog

| Version | Change |
|---------|--------|
| v1.22.0 | Added telemetry logging, timeout enforcement, loadPlugin tests |
| v1.20.0 | Initial plugin system with worker isolation |