# Cloud Sync (Cloudflare R2)

`services/cloudSync/` — `cloudSyncBackend.ts` (StorageBackend, API keys never sent to cloud), `cloudSyncClient.ts` (fetch + Bearer token), `cloudSyncEncryption.ts` (AES-256-GCM E2E). The `enableCloudSync` feature flag was **retired** in v1.20; use `CloudSyncBackend.create(..., explicitConsent = true)` as the activation gate. This service is not yet wired into `storageService` (v2.0 feature).
