# Backend

This directory is reserved for future server-side components of WorldScript Studio.

## Planned Components

| Component | Status | Description |
|-----------|--------|-------------|
| Cloud-Sync Worker | Planned | Cloudflare Worker for E2E-encrypted cloud sync (`services/cloudSync/*`) |
| Model Hosting | Future | Optional self-hosted model inference endpoint |

## Current Status

As of v1.17, all application logic runs entirely in the browser or Tauri desktop runtime.
No server-side code is required for the core application.

## Notes

- Do not remove this directory — it is referenced in project scaffolding and planned for v2.x server-side features.
- All backend work will be feature-flagged and opt-in only.
