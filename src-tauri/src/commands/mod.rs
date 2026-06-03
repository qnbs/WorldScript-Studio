//! Tauri command modules grouped under `commands::`.
//! QNBS-v3: Phase 3 — WorkerBus v2 Rust TaskSupervisor lives here. Keeps the
//!          native-compute surface isolated from the flat top-level command files
//!          (lora.rs / pandoc.rs) so the supervisor can grow its own task registry.

pub mod task_supervisor;
