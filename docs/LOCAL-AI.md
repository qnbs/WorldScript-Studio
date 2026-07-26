# Local AI — Setup & Troubleshooting

WorldScript Studio can run its AI Co-Pilot **entirely on your device** — no API key, no
network, no data leaving the browser. This guide explains how to set it up, what hardware
it needs, how to manage the model downloads, and how the offline fallback works.

The settings live in **Settings → AI Models → Local AI**.

---

## Quick start

1. Open **Settings → AI Models → Local AI**.
2. Check the **Capability** card:
   - **WebGPU: Available** → you can run the fast, high-quality models.
   - **WebGPU: Not available** → you can still run smaller CPU/WASM models, just slower.
3. Pick a model from the **Models** list and press **Download**. The first download streams
   the model weights (a few hundred MB to several GB) and shows a progress bar with an ETA.
4. Once a model shows the **Ready** badge, switch the execution mode (Settings → AI Models →
   AI, or the chip in the Co-Pilot header) to **Local**, **Hybrid**, or **Eco**.

> The download runs in a background worker. You can keep writing while it streams; the
> progress modal can be cancelled at any time.

---

## Hardware & browser requirements

| Capability | Needed for | How to check |
|---|---|---|
| **WebGPU** | Fast WebLLM models (Llama, Phi, Gemma) | Capability card, or `chrome://gpu` |
| **~1–5 GB free storage** | Storing model weights | Storage card |
| **4+ GB RAM** | Mid-size models without thrashing | Device-class badge |

- **WebGPU** is available in recent Chrome/Edge (and Chromium-based browsers) and increasingly
  in Safari/Firefox. If the Capability card says *Not available*, update your browser or enable
  the WebGPU flag.
- The **Device class** badge (High-end / Mid-range / Low-end) is derived from your GPU VRAM tier
  and CPU cores, and drives the **Recommended for your device** suggestion.

### Model sizes (approximate on-disk)

| Model | Size | Best for |
|---|---|---|
| Qwen 2.5 0.5B | ~0.4 GB | Eco / very low-end |
| Llama 3.2 1B | ~0.7 GB | Fast, low-end |
| Gemma 3 1B | ~0.8 GB | Low-end |
| Llama 3.2 3B | ~1.8 GB | Mid-range |
| Phi-4 Mini 3.8B | ~2.3 GB | Mid/high-end |
| Gemma 3 4B | ~4.9 GB | High-end |
| Llama 3.3 70B | ~35 GB | Workstation GPUs only |

If a model needs more space than you have free, the Models list shows a **size warning** and
you should clear space or pick a smaller model first.

---

## Storage management

Downloaded model weights are cached on disk by the browser (Cache API), **not** in your
project data. They persist across sessions so you don't re-download every time.

- The **Storage** card shows total origin usage, your quota, and how many local-model cache
  buckets exist on disk.
- **Clear Local Models** deletes every downloaded model and releases in-memory GPU/WASM
  handles. Your projects are untouched. Models re-download automatically the next time you
  use local AI.

> Browsers enforce a per-origin storage quota and may evict caches under storage pressure. If
> a model silently re-downloads, your browser likely evicted it — this is expected on
> low-storage devices.

---

## The fallback chain

When the preferred layer can't run, the Co-Pilot automatically tries the next one, so local
AI degrades gracefully instead of failing:

1. **WebGPU (WebLLM)** — fastest and highest quality; needs a capable GPU.
2. **WASM (ONNX)** — runs on the CPU when no GPU is available.
3. **Transformers.js** — lightweight last-resort generator.
4. **Heuristic** — an always-available offline stub when no model can run.

In **Hybrid** mode, the cloud provider is tried first and the local chain is the offline
fallback. In **Local** and **Eco** modes, only the on-device chain is used.

---

## Web ↔ Desktop notes

- **Web (PWA):** models are cached per browser/origin. Clearing site data or browser cache
  removes them. Different browsers do not share downloads.
- **Desktop (Tauri):** the same WebGPU/WASM runtimes apply; downloads live in the app's
  WebView storage. For server-grade local models, point the **Ollama** provider at a local
  server instead (Settings → AI Models → AI → Advanced) — see the next section.

---

## Ollama / LM Studio / vLLM servers (desktop only)

For server-grade local models, WorldScript Studio talks to a **local inference server** over
HTTP instead of running the model in the WebView:

| Server | Default URL | Notes |
|---|---|---|
| **Ollama** | `http://localhost:11434` | `ollama serve`; models via the Models list or `ollama pull` |
| **LM Studio** | `http://localhost:1234` | Enable the local server in LM Studio (Developer tab) |
| **vLLM** | `http://localhost:8000` | Any OpenAI-compatible `/v1` server works |

Setup: **Settings → AI Models → AI → Advanced**, pick the **Ollama** provider, choose a preset
(or enter a custom base URL), then press **Scan common local ports**. Every endpoint gets a
live status badge (reachable / no response / timeout / HTTP error); a reachable server offers a
one-click **Use this URL** action.

### Why this only works in the desktop app

- **Desktop (Tauri):** all local-server traffic goes through the **Tauri HTTP plugin** (native
  Rust networking), not the WebView's `fetch`. Native requests are not subject to browser CORS or
  Private-Network-Access rules, so Ollama/LM Studio answer directly — **no `OLLAMA_ORIGINS`
  configuration needed**. The Tauri capability scope is pinned to `localhost`/`127.0.0.1`
  (`src-tauri/capabilities/default.json`); the CSP already lists the three well-known ports.
- **Web (PWA):** browsers treat `http://localhost:*` as cross-origin **and** as a private-network
  target. Without server-side CORS headers (`OLLAMA_ORIGINS=…` including your PWA origin) every
  request is blocked — this is a browser security boundary, not a bug. The PWA therefore shows a
  banner with a link to the desktop download instead of probing your machine, and never fires
  automatic localhost requests (no CORS noise in the console).

See [ADR 0012](adr/0012-local-server-connectivity-tauri-http.md) for the full root-cause analysis
(issue #266).

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Download never starts / "Not available" | No WebGPU **and** no WASM fallback | Update browser; try a smaller ONNX model; or use Ollama. |
| Download stalls or fails midway | Network drop or storage eviction | Cancel and retry; free space via **Clear Local Models**. |
| "Another WorldScript tab holds the local inference lock" | Multi-tab GPU contention | Close other WorldScript tabs (only one tab loads the GPU model). |
| Very slow generation | Low-end device / CPU fallback | Pick a smaller model or use **Eco** mode. |
| Storage estimate unavailable | Browser without StorageManager | Informational only; downloads still work. |
| Ollama/LM Studio not detected (desktop) | Server not running, or custom port | Run `ollama serve` / start the LM Studio server; press **Scan common local ports**; check the base URL. |
| CORS errors mention `localhost:11434` (browser) | Ollama selected inside the PWA | Expected browser boundary — use the desktop app for local servers (see banner in Settings → AI). |
| Scan shows **timeout** | Server busy loading a model or firewall interference | Retry after the model finishes loading; check OS firewall for localhost. |

The **Last local run: N tokens/sec** line under the fallback chain reflects the throughput
of your most recent on-device generation — a quick way to compare models on your hardware.

---

## Related

- **Settings → AI Models → AI** — provider selection, Ollama, execution mode.
- [`docs/COPILOT.md`](COPILOT.md) — the AI Co-Pilot.
- Architecture: `services/localAiFacade.ts`, `services/ai/localModelStorageService.ts`,
  `services/ai/deviceHealthService.ts`, `packages/ai-core`.
