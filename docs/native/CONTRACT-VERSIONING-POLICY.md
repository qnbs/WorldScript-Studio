# Native contract versioning policy

Status: Locally proven for the bounded Rust TaskSupervisor contract (`1.0.0`); merge-gated CI is the next evidence level.

This policy applies to renderer-neutral contracts that cross the Tauri/Rust boundary. It does not
make Tauri authoritative and it does not replace the separate `schemaVersion` used by project
data migrations.

## Rules

1. Every native request and result envelope carries a required `contractVersion`.
2. The TypeScript contract constant and the Rust implementation constant must match exactly. The
   boundary rejects an unsupported version before dispatch and the TypeScript adapter rejects a
   malformed or mismatched result before application code can trust it.
3. A breaking wire-shape or semantic change requires a new major version and an explicit migration
   or compatibility window. Additive changes require an intentional minor-version policy update;
   they must not be smuggled into an existing version.
4. Field names are camelCase on the wire. Rust structs use `serde(rename_all = "camelCase")`, and
   TypeScript validates the envelope with the shared Zod schema.
5. Contract tests must cover both an accepted current version and rejection of an unsupported
   version. A green test proves the boundary policy, not production authority or renderer parity.

## Current bounded contract

`@domain/worker-bus` exports `RUST_TASK_CONTRACT_VERSION = "1.0.0"`. The Rust
`worldscript_task_supervisor_submit` command requires the same value and returns it in both
successful and structured-failure `RustTaskResultEvent` envelopes. The DesktopPlatform adapter
validates both request and result envelopes. `text.analyze` and `text.diff` remain bounded proof
tasks; full worker-bus extraction and an authority switch are still open roadmap work.
