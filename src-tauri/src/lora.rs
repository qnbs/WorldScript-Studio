/**
 * LoRA Fine-Tuning Tauri Commands
 * QNBS-v3: Bridges the Unsloth/PEFT Python sidecar with the TypeScript front-end.
 *          Progress events are streamed via app.emit("lora-progress", ...).
 */
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::Path,
    process::{Command as StdCommand, Stdio},
    sync::{Mutex, OnceLock},
};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

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
static ACTIVE_LORA_TRAINING_PID: OnceLock<Mutex<Option<u32>>> = OnceLock::new();

#[derive(Debug, Clone)]
struct ResolvedPython {
    path: String,
    version: String,
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

fn probe_python(candidate: &str) -> Result<ResolvedPython, String> {
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

    let output = StdCommand::new(candidate)
        .arg("--version")
        .output()
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

fn configured_python_path(app: &AppHandle) -> Result<Option<String>, String> {
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

fn resolve_python(app: &AppHandle) -> Result<ResolvedPython, String> {
    if let Some(configured) = configured_python_path(app)? {
        // QNBS-v3: An explicit user choice must never silently fall back to a different interpreter.
        return probe_python(&configured);
    }

    let mut last_error = "executable_not_found".to_string();
    let candidates: &[&str] = if cfg!(windows) {
        &["python.exe", "python3.exe", "python", "python3"]
    } else {
        &[
            "python3",
            "python",
            "/usr/bin/python3",
            "/usr/local/bin/python3",
            "/opt/homebrew/bin/python3",
        ]
    };
    for candidate in candidates {
        match probe_python(candidate) {
            Ok(runtime) => return Ok(runtime),
            Err(error) => last_error = error,
        }
    }
    Err(last_error)
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

fn active_training_pid() -> &'static Mutex<Option<u32>> {
    ACTIVE_LORA_TRAINING_PID.get_or_init(|| Mutex::new(None))
}

fn set_active_training_pid(pid: Option<u32>) -> Result<(), String> {
    let mut active = active_training_pid()
        .lock()
        .map_err(|_| "training_state_unavailable".to_string())?;
    *active = pid;
    Ok(())
}

fn current_training_pid() -> Result<Option<u32>, String> {
    active_training_pid()
        .lock()
        .map(|active| *active)
        .map_err(|_| "training_state_unavailable".to_string())
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Train a LoRA adapter via the Python sidecar (Unsloth + PEFT).
/// Streams progress as Tauri events ("lora-progress").
#[tauri::command]
pub async fn train_lora(app: AppHandle, payload: LoraTrainPayload) -> Result<String, String> {
    if current_training_pid()?.is_some() {
        return Err("training_already_running".to_string());
    }
    let script_path = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Resource dir error: {e}"))?
        .join("scripts")
        .join("train_writer_lora.py");

    if !script_path.exists() {
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

    let python = resolve_python(&app)
        .map_err(|category| format!("Python runtime unavailable ({category})"))?;

    let mut child = Command::new(&python.path)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn Python: {e}. Is Python 3 installed?"))?;

    let pid = child
        .id()
        .ok_or_else(|| "training_process_id_unavailable".to_string())?;
    set_active_training_pid(Some(pid))?;
    let stdout = match child.stdout.take() {
        Some(stdout) => stdout,
        None => {
            set_active_training_pid(None)?;
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
    // QNBS-v3: Clear the exact tracked process only after wait, so Cancel never targets another Python runtime.
    if current_training_pid()? == Some(pid) {
        set_active_training_pid(None)?;
    }
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

    let python = resolve_python(&app)
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

/// Abort the currently running training process (best-effort via process group).
#[tauri::command]
pub async fn abort_lora_training() -> Result<(), String> {
    let Some(pid) = current_training_pid()? else {
        return Ok(());
    };
    let pid_text = pid.to_string();
    // QNBS-v3: Kill only the process this app started; never a global hard-coded Python executable.
    #[cfg(unix)]
    {
        Command::new("kill")
            .args(["-TERM", &pid_text])
            .output()
            .await
            .map_err(|_| "training_cancel_spawn_failed".to_string())?;
    }
    #[cfg(windows)]
    {
        Command::new("taskkill")
            .args(["/PID", &pid_text, "/T", "/F"])
            .output()
            .await
            .map_err(|_| "training_cancel_spawn_failed".to_string())?;
    }
    Ok(())
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
    let python = match resolve_python(&app) {
        Ok(runtime) => runtime,
        Err(error) => return Ok(unavailable_report(error)),
    };
    let script_path = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("scripts")
        .join("check_lora_env.py");

    if !script_path.exists() {
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

    let output = Command::new(&python.path)
        .args([script_path.to_string_lossy().as_ref()])
        .output()
        .await;

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
    let runtime = probe_python(python_path)?;
    let config_path = app
        .path()
        .app_data_dir()
        .map_err(|_| "configuration_path_unavailable".to_string())?
        .join(PYTHON_CONFIG_FILE);
    let parent = config_path
        .parent()
        .ok_or_else(|| "configuration_path_unavailable".to_string())?;
    fs::create_dir_all(parent).map_err(|_| "configuration_write_failed".to_string())?;
    fs::write(&config_path, &runtime.path).map_err(|_| "configuration_write_failed".to_string())?;
    check_lora_environment(app).await
}

#[cfg(test)]
mod tests {
    use super::parse_python_version;

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
}
