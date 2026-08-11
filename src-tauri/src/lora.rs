/**
 * LoRA Fine-Tuning Tauri Commands
 * QNBS-v3: Bridges the Unsloth/PEFT Python sidecar with the TypeScript front-end.
 *          Progress events are streamed via app.emit("lora-progress", ...).
 */
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{Mutex, OnceLock},
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::time::{sleep, timeout};

// ---------------------------------------------------------------------------
// Payload types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LoraTrainPayload {
    pub model_id: String,
    pub dataset_path: String,
    pub output_dir: String,
    pub preset: String,
    pub rank: Option<u8>,
    pub alpha: Option<u8>,
    pub epochs: Option<u8>,
    pub max_seq_len: Option<u16>,
}

// QNBS-v3: Deserialize required — check_lora_environment parses the Python sidecar's
//          JSON stdout into this struct via serde_json::from_str (lora.rs:209). Missing
//          derive broke the whole crate compile (tauri-build red since 2026-05-30).
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LoraEnvReport {
    pub python_available: bool,
    pub unsloth_available: bool,
    pub cuda_available: bool,
    pub vram_gb: f32,
    pub python_version: String,
    pub python_path: Option<String>,
    pub last_error: Option<String>,
}

const PYTHON_CONFIG_FILE: &str = "lora-python-path.txt";
const MIN_PYTHON_MAJOR: u32 = 3;
const MIN_PYTHON_MINOR: u32 = 10;
const PYTHON_PROBE_TIMEOUT: Duration = Duration::from_secs(5);
const PYTHON_RESOLUTION_TIMEOUT: Duration = Duration::from_secs(20);
const LORA_ENV_CHECK_TIMEOUT: Duration = Duration::from_secs(20);
const TRAINING_CANCEL_CONFIRM_ATTEMPTS: usize = 30;
const TRAINING_CANCEL_CONFIRM_INTERVAL: Duration = Duration::from_millis(100);
static ACTIVE_LORA_TRAINING: OnceLock<Mutex<TrainingState>> = OnceLock::new();
static CACHED_PYTHON: OnceLock<Mutex<Option<ResolvedPython>>> = OnceLock::new();

#[derive(Debug, Clone)]
struct ResolvedPython {
    path: String,
    version: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TrainingState {
    Idle,
    Starting,
    CancelRequested,
    Running(u32),
    Stopping(u32),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AbortTrainingRequest {
    NothingRunning,
    CancelPendingStart,
    StopProcess(u32),
    AlreadyStopping(u32),
}

fn parse_python_version(raw: &str) -> Option<(u32, u32, String)> {
    let version = raw
        .split_whitespace()
        .find(|part| part.chars().next().is_some_and(|c| c.is_ascii_digit()))?;
    let mut components = version.split('.');
    let major = components.next()?.parse::<u32>().ok()?;
    let minor = components.next()?.parse::<u32>().ok()?;
    Some((major, minor, version.to_string()))
}

fn validate_python_candidate_path(candidate: &str) -> Result<(), String> {
    let path = Path::new(candidate);
    if path.is_absolute() {
        if !path.is_file() {
            return Err("configured_path_missing".to_string());
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = path
                .metadata()
                .map_err(|_| "configured_path_missing".to_string())?
                .permissions()
                .mode();
            if mode & 0o111 == 0 {
                return Err("permission_denied".to_string());
            }
        }
    }

    Ok(())
}

async fn probe_python(candidate: String) -> Result<ResolvedPython, String> {
    let validation_candidate = candidate.clone();
    tokio::task::spawn_blocking(move || validate_python_candidate_path(&validation_candidate))
        .await
        .map_err(|_| "python_probe_task_failed".to_string())??;

    let mut command = Command::new(&candidate);
    command
        .arg("--version")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // QNBS-v3: A timed-out interpreter probe must not leave a hidden child consuming desktop resources.
        .kill_on_drop(true);
    let output = timeout(PYTHON_PROBE_TIMEOUT, command.output())
        .await
        .map_err(|_| "version_probe_timed_out".to_string())?
        .map_err(|error| match error.kind() {
            std::io::ErrorKind::NotFound => "executable_not_found".to_string(),
            std::io::ErrorKind::PermissionDenied => "permission_denied".to_string(),
            _ => "process_spawn_failed".to_string(),
        })?;

    if !output.status.success() {
        return Err("version_probe_failed".to_string());
    }

    let output_text = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let (major, minor, version) =
        parse_python_version(&output_text).ok_or_else(|| "version_parse_failed".to_string())?;
    if (major, minor) < (MIN_PYTHON_MAJOR, MIN_PYTHON_MINOR) {
        return Err("incompatible_version".to_string());
    }

    Ok(ResolvedPython {
        path: candidate.to_string(),
        version,
    })
}

fn configured_python_path_blocking(app: &AppHandle) -> Result<Option<String>, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|_| "configuration_path_unavailable".to_string())?
        .join(PYTHON_CONFIG_FILE);
    match fs::read_to_string(path) {
        Ok(value) => {
            let value = value.trim();
            Ok((!value.is_empty()).then(|| value.to_string()))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err("configuration_read_failed".to_string()),
    }
}

async fn configured_python_path(app: AppHandle) -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(move || configured_python_path_blocking(&app))
        .await
        .map_err(|_| "configuration_read_failed".to_string())?
}

fn cached_python() -> &'static Mutex<Option<ResolvedPython>> {
    CACHED_PYTHON.get_or_init(|| Mutex::new(None))
}

fn read_cached_python() -> Result<Option<ResolvedPython>, String> {
    cached_python()
        .lock()
        .map(|cached| cached.clone())
        .map_err(|_| "python_cache_unavailable".to_string())
}

fn cache_python(runtime: ResolvedPython) -> Result<(), String> {
    let mut cached = cached_python()
        .lock()
        .map_err(|_| "python_cache_unavailable".to_string())?;
    *cached = Some(runtime);
    Ok(())
}

fn python_candidates() -> Vec<String> {
    if cfg!(windows) {
        ["python.exe", "python3.exe", "python", "python3"]
            .into_iter()
            .map(str::to_string)
            .collect()
    } else {
        [
            "python3",
            "python",
            "/usr/bin/python3",
            "/usr/local/bin/python3",
            "/opt/homebrew/bin/python3",
        ]
        .into_iter()
        .map(str::to_string)
        .collect()
    }
}

async fn resolve_python(app: AppHandle) -> Result<ResolvedPython, String> {
    let configured = configured_python_path(app).await?;
    if let Some(configured) = configured {
        if let Some(cached) = read_cached_python()? {
            if cached.path == configured {
                return Ok(cached);
            }
        }
        // QNBS-v3: An explicit user choice must never silently fall back to a different interpreter.
        let runtime = probe_python(configured).await?;
        cache_python(runtime.clone())?;
        return Ok(runtime);
    }

    if let Some(cached) = read_cached_python()? {
        return Ok(cached);
    }

    let runtime = timeout(PYTHON_RESOLUTION_TIMEOUT, async {
        let mut last_error = "executable_not_found".to_string();
        for candidate in python_candidates() {
            match probe_python(candidate).await {
                Ok(runtime) => return Ok(runtime),
                Err(error) => last_error = error,
            }
        }
        Err(last_error)
    })
    .await
    .map_err(|_| "python_resolution_timed_out".to_string())??;
    cache_python(runtime.clone())?;
    Ok(runtime)
}

fn unavailable_report(error: String) -> LoraEnvReport {
    LoraEnvReport {
        python_available: false,
        unsloth_available: false,
        cuda_available: false,
        vram_gb: 0.0,
        python_version: String::new(),
        python_path: None,
        last_error: Some(error),
    }
}

fn active_training_state() -> &'static Mutex<TrainingState> {
    ACTIVE_LORA_TRAINING.get_or_init(|| Mutex::new(TrainingState::Idle))
}

fn reserve_training_slot() -> Result<(), String> {
    let mut state = active_training_state()
        .lock()
        .map_err(|_| "training_state_unavailable".to_string())?;
    if *state != TrainingState::Idle {
        return Err("training_already_running".to_string());
    }
    // QNBS-v3: Reserve before any await so concurrent invokes cannot spawn duplicate GPU-heavy children.
    *state = TrainingState::Starting;
    Ok(())
}

fn release_pending_training_slot() -> Result<(), String> {
    let mut state = active_training_state()
        .lock()
        .map_err(|_| "training_state_unavailable".to_string())?;
    if matches!(
        *state,
        TrainingState::Starting | TrainingState::CancelRequested
    ) {
        *state = TrainingState::Idle;
    }
    Ok(())
}

fn ensure_training_start_not_cancelled() -> Result<(), String> {
    let mut state = active_training_state()
        .lock()
        .map_err(|_| "training_state_unavailable".to_string())?;
    match *state {
        TrainingState::Starting => Ok(()),
        TrainingState::CancelRequested => {
            *state = TrainingState::Idle;
            Err("training_cancelled".to_string())
        }
        _ => Err("training_state_conflict".to_string()),
    }
}

fn mark_training_running(pid: u32) -> Result<(), String> {
    let mut state = active_training_state()
        .lock()
        .map_err(|_| "training_state_unavailable".to_string())?;
    match *state {
        TrainingState::Starting => {
            *state = TrainingState::Running(pid);
            Ok(())
        }
        TrainingState::CancelRequested => {
            *state = TrainingState::Idle;
            Err("training_cancelled".to_string())
        }
        _ => Err("training_state_conflict".to_string()),
    }
}

fn clear_training_if(pid: u32) -> Result<(), String> {
    let mut state = active_training_state()
        .lock()
        .map_err(|_| "training_state_unavailable".to_string())?;
    match *state {
        TrainingState::Running(current) | TrainingState::Stopping(current) if current == pid => {
            *state = TrainingState::Idle;
        }
        _ => {}
    }
    Ok(())
}

fn request_training_abort() -> Result<AbortTrainingRequest, String> {
    let mut state = active_training_state()
        .lock()
        .map_err(|_| "training_state_unavailable".to_string())?;
    match *state {
        TrainingState::Idle => Ok(AbortTrainingRequest::NothingRunning),
        TrainingState::Starting => {
            *state = TrainingState::CancelRequested;
            Ok(AbortTrainingRequest::CancelPendingStart)
        }
        TrainingState::CancelRequested => Ok(AbortTrainingRequest::CancelPendingStart),
        TrainingState::Running(pid) => {
            *state = TrainingState::Stopping(pid);
            Ok(AbortTrainingRequest::StopProcess(pid))
        }
        TrainingState::Stopping(pid) => Ok(AbortTrainingRequest::AlreadyStopping(pid)),
    }
}

fn restore_running_training(pid: u32) -> Result<(), String> {
    let mut state = active_training_state()
        .lock()
        .map_err(|_| "training_state_unavailable".to_string())?;
    if *state == TrainingState::Stopping(pid) {
        *state = TrainingState::Running(pid);
    }
    Ok(())
}

async fn file_exists(path: PathBuf) -> Result<bool, String> {
    tokio::task::spawn_blocking(move || path.is_file())
        .await
        .map_err(|_| "filesystem_probe_failed".to_string())
}

async fn persist_configured_python_path(app: AppHandle, python_path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let config_path = app
            .path()
            .app_data_dir()
            .map_err(|_| "configuration_path_unavailable".to_string())?
            .join(PYTHON_CONFIG_FILE);
        let parent = config_path
            .parent()
            .ok_or_else(|| "configuration_path_unavailable".to_string())?;
        fs::create_dir_all(parent).map_err(|_| "configuration_write_failed".to_string())?;
        fs::write(&config_path, python_path).map_err(|_| "configuration_write_failed".to_string())
    })
    .await
    .map_err(|_| "configuration_write_failed".to_string())?
}

#[cfg(unix)]
async fn is_training_process_running(pid: u32) -> Result<bool, String> {
    let process_group = format!("-{pid}");
    let status = Command::new("kill")
        .args(["-0", "--", process_group.as_str()])
        .status()
        .await
        .map_err(|_| "training_cancel_probe_failed".to_string())?;
    Ok(status.success())
}

#[cfg(windows)]
async fn is_training_process_running(pid: u32) -> Result<bool, String> {
    let filter = format!("PID eq {pid}");
    let output = Command::new("tasklist")
        .args(["/FI", filter.as_str(), "/NH"])
        .output()
        .await
        .map_err(|_| "training_cancel_probe_failed".to_string())?;
    if !output.status.success() {
        return Err("training_cancel_probe_failed".to_string());
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout
        .split_whitespace()
        .any(|token| token == pid.to_string()))
}

async fn confirm_training_process_terminated(pid: u32) -> Result<bool, String> {
    for _ in 0..TRAINING_CANCEL_CONFIRM_ATTEMPTS {
        if !is_training_process_running(pid).await? {
            return Ok(true);
        }
        sleep(TRAINING_CANCEL_CONFIRM_INTERVAL).await;
    }
    Ok(false)
}

async fn terminate_training_process(pid: u32) -> Result<(), String> {
    #[cfg(unix)]
    let output = {
        let process_group = format!("-{pid}");
        Command::new("kill")
            .args(["-TERM", "--", process_group.as_str()])
            .output()
            .await
            .map_err(|_| "training_cancel_spawn_failed".to_string())?
    };
    #[cfg(windows)]
    let output = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .output()
        .await
        .map_err(|_| "training_cancel_spawn_failed".to_string())?;

    if !output.status.success() && is_training_process_running(pid).await? {
        return Err("training_cancel_signal_failed".to_string());
    }
    if confirm_training_process_terminated(pid).await? {
        Ok(())
    } else {
        Err("training_cancel_not_confirmed".to_string())
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Train a LoRA adapter via the Python sidecar (Unsloth + PEFT).
/// Streams progress as Tauri events ("lora-progress").
#[tauri::command]
pub async fn train_lora(app: AppHandle, payload: LoraTrainPayload) -> Result<String, String> {
    reserve_training_slot()?;
    let script_path = match app.path().resource_dir() {
        Ok(path) => path,
        Err(error) => {
            release_pending_training_slot()?;
            return Err(format!("Resource dir error: {error}"));
        }
    }
    .join("scripts")
    .join("train_writer_lora.py");

    let script_exists = match file_exists(script_path.clone()).await {
        Ok(exists) => exists,
        Err(error) => {
            release_pending_training_slot()?;
            return Err(error);
        }
    };
    if !script_exists {
        release_pending_training_slot()?;
        return Err(format!(
            "Training script not found at {}",
            script_path.display()
        ));
    }

    let mut args = vec![
        script_path.to_string_lossy().to_string(),
        "--model".into(),
        payload.model_id,
        "--dataset".into(),
        payload.dataset_path,
        "--output-dir".into(),
        payload.output_dir,
        "--preset".into(),
        payload.preset,
    ];

    if let Some(r) = payload.rank {
        args.extend(["--rank".into(), r.to_string()]);
    }
    if let Some(a) = payload.alpha {
        args.extend(["--alpha".into(), a.to_string()]);
    }
    if let Some(e) = payload.epochs {
        args.extend(["--epochs".into(), e.to_string()]);
    }
    if let Some(s) = payload.max_seq_len {
        args.extend(["--max-seq-len".into(), s.to_string()]);
    }

    let python = match resolve_python(app.clone()).await {
        Ok(runtime) => runtime,
        Err(category) => {
            release_pending_training_slot()?;
            return Err(format!("Python runtime unavailable ({category})"));
        }
    };
    if let Err(error) = ensure_training_start_not_cancelled() {
        release_pending_training_slot()?;
        return Err(error);
    }

    let mut command = Command::new(&python.path);
    command
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(unix)]
    command.process_group(0);
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            release_pending_training_slot()?;
            return Err(format!(
                "Failed to spawn Python: {error}. Is Python 3 installed?"
            ));
        }
    };

    let pid = match child.id() {
        Some(pid) => pid,
        None => {
            let _ = child.start_kill();
            let _ = child.wait().await;
            release_pending_training_slot()?;
            return Err("training_process_id_unavailable".to_string());
        }
    };
    if let Err(error) = mark_training_running(pid) {
        let _ = child.start_kill();
        let _ = child.wait().await;
        return Err(error);
    }
    let stdout = match child.stdout.take() {
        Some(stdout) => stdout,
        None => {
            let _ = child.start_kill();
            let _ = child.wait().await;
            clear_training_if(pid)?;
            return Err("No stdout".to_string());
        }
    };
    let app_clone = app.clone();

    // Stream stdout lines as Tauri events
    tokio::spawn(async move {
        let mut reader = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) {
                let _ = app_clone.emit("lora-progress", value);
            }
        }
    });

    let output_result = child.wait_with_output().await;
    // QNBS-v3: Clear only after reaping this exact child, so a completed cancellation cannot free a newer run.
    clear_training_if(pid)?;
    let output = output_result.map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok("training_completed".to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!(
            "Training failed: {}",
            &stderr[..stderr.len().min(500)]
        ))
    }
}

/// Merge a LoRA adapter into the base model weights (produces a merged GGUF).
#[tauri::command]
pub async fn merge_lora(
    app: AppHandle,
    base_model: String,
    adapter_path: String,
    output_path: String,
) -> Result<(), String> {
    let script_path = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("scripts")
        .join("train_writer_lora.py");

    let python = resolve_python(app.clone())
        .await
        .map_err(|category| format!("Python runtime unavailable ({category})"))?;

    let output = Command::new(&python.path)
        .args([
            script_path.to_string_lossy().as_ref(),
            "--merge",
            "--model",
            &base_model,
            "--adapter",
            &adapter_path,
            "--output-dir",
            &output_path,
        ])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

/// Abort the currently running training process and confirm its process group exits.
#[tauri::command]
pub async fn abort_lora_training() -> Result<(), String> {
    match request_training_abort()? {
        AbortTrainingRequest::NothingRunning | AbortTrainingRequest::CancelPendingStart => Ok(()),
        AbortTrainingRequest::StopProcess(pid) => {
            if let Err(error) = terminate_training_process(pid).await {
                if error != "training_cancel_not_confirmed" {
                    restore_running_training(pid)?;
                }
                return Err(error);
            }
            Ok(())
        }
        AbortTrainingRequest::AlreadyStopping(pid) => {
            if confirm_training_process_terminated(pid).await? {
                Ok(())
            } else {
                Err("training_cancellation_in_progress".to_string())
            }
        }
    }
}

/// Generate an Ollama Modelfile string for an adapter.
#[tauri::command]
pub fn generate_ollama_modelfile(base_model: String, adapter_path: String, name: String) -> String {
    format!(
        "FROM {base_model}\nADAPTER {adapter_path}\nSYSTEM \"You are {name}, a creative writing assistant trained on this author's unique style. Match their voice, rhythm, and vocabulary precisely.\"\n"
    )
}

/// Check Python + Unsloth environment availability.
#[tauri::command]
pub async fn check_lora_environment(app: AppHandle) -> Result<LoraEnvReport, String> {
    let python = match resolve_python(app.clone()).await {
        Ok(runtime) => runtime,
        Err(error) => return Ok(unavailable_report(error)),
    };
    let script_path = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("scripts")
        .join("check_lora_env.py");

    if !file_exists(script_path.clone()).await? {
        return Ok(LoraEnvReport {
            python_available: true,
            unsloth_available: false,
            cuda_available: false,
            vram_gb: 0.0,
            python_version: python.version,
            python_path: Some(python.path),
            last_error: Some("helper_script_missing".to_string()),
        });
    }

    let mut command = Command::new(&python.path);
    command
        .arg(script_path.to_string_lossy().as_ref())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // QNBS-v3: An environment diagnostic must not leave a stalled helper process behind.
        .kill_on_drop(true);
    let output = match timeout(LORA_ENV_CHECK_TIMEOUT, command.output()).await {
        Ok(output) => output,
        Err(_) => {
            return Ok(LoraEnvReport {
                python_available: true,
                unsloth_available: false,
                cuda_available: false,
                vram_gb: 0.0,
                python_version: python.version,
                python_path: Some(python.path),
                last_error: Some("helper_timed_out".to_string()),
            });
        }
    };

    match output {
        Err(_) => Ok(LoraEnvReport {
            python_available: true,
            unsloth_available: false,
            cuda_available: false,
            vram_gb: 0.0,
            python_version: python.version,
            python_path: Some(python.path),
            last_error: Some("helper_spawn_failed".to_string()),
        }),
        Ok(out) => {
            if !out.status.success() {
                return Ok(LoraEnvReport {
                    python_available: true,
                    unsloth_available: false,
                    cuda_available: false,
                    vram_gb: 0.0,
                    python_version: python.version,
                    python_path: Some(python.path),
                    last_error: Some("helper_exit_nonzero".to_string()),
                });
            }
            let stdout = String::from_utf8_lossy(&out.stdout);
            let mut report = match serde_json::from_str::<LoraEnvReport>(&stdout) {
                Ok(report) => report,
                Err(_) => {
                    return Ok(LoraEnvReport {
                        python_available: true,
                        unsloth_available: false,
                        cuda_available: false,
                        vram_gb: 0.0,
                        python_version: python.version,
                        python_path: Some(python.path),
                        last_error: Some("helper_report_parse_failed".to_string()),
                    });
                }
            };
            report.python_available = true;
            report.python_version = python.version;
            report.python_path = Some(python.path);
            report.last_error = None;
            Ok(report)
        }
    }
}

/// Persist a user-selected interpreter only after validating it with a harmless version probe.
#[tauri::command]
pub async fn set_lora_python_path(
    app: AppHandle,
    python_path: String,
) -> Result<LoraEnvReport, String> {
    let python_path = python_path.trim();
    if python_path.is_empty() {
        return Err("configured_path_empty".to_string());
    }
    if !Path::new(python_path).is_absolute() {
        return Err("configured_path_not_absolute".to_string());
    }
    let runtime = probe_python(python_path.to_string()).await?;
    persist_configured_python_path(app.clone(), runtime.path.clone()).await?;
    cache_python(runtime)?;
    check_lora_environment(app).await
}

#[cfg(test)]
mod tests {
    use super::{
        active_training_state, clear_training_if, ensure_training_start_not_cancelled,
        mark_training_running, parse_python_version, request_training_abort, reserve_training_slot,
        AbortTrainingRequest, TrainingState,
    };

    fn reset_training_state() {
        *active_training_state()
            .lock()
            .expect("training test mutex should not be poisoned") = TrainingState::Idle;
    }

    #[test]
    fn parses_python_version_from_stderr_style_output() {
        assert_eq!(
            parse_python_version("Python 3.11.9"),
            Some((3, 11, "3.11.9".to_string()))
        );
    }

    #[test]
    fn rejects_malformed_python_version_output() {
        assert_eq!(parse_python_version("not-python"), None);
    }

    #[test]
    fn training_slot_rejects_a_second_start_and_honors_cancel_during_startup() {
        reset_training_state();
        reserve_training_slot().expect("first training slot should reserve");
        assert_eq!(
            reserve_training_slot(),
            Err("training_already_running".to_string())
        );
        assert_eq!(
            request_training_abort().expect("startup cancellation should be recorded"),
            AbortTrainingRequest::CancelPendingStart
        );
        assert_eq!(
            ensure_training_start_not_cancelled(),
            Err("training_cancelled".to_string())
        );
        reserve_training_slot().expect("cancelled startup must release the slot");
        reset_training_state();
    }

    #[test]
    fn an_old_child_cannot_clear_a_different_active_training_run() {
        reset_training_state();
        reserve_training_slot().expect("training slot should reserve");
        mark_training_running(41).expect("first child should own the slot");
        clear_training_if(99).expect("unrelated child cleanup should be safe");
        assert_eq!(
            reserve_training_slot(),
            Err("training_already_running".to_string())
        );
        clear_training_if(41).expect("tracked child cleanup should release the slot");
        reserve_training_slot().expect("reaped child must release the slot");
        reset_training_state();
    }
}
