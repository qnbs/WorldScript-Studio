/**
 * LoRA Fine-Tuning Tauri Commands
 * QNBS-v3: Bridges the Unsloth/PEFT Python sidecar with the TypeScript front-end.
 *          Progress events are streamed via app.emit("lora-progress", ...).
 */

use serde::{Deserialize, Serialize};
use std::process::Stdio;
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

#[derive(Debug, Serialize, Clone)]
pub struct LoraEnvReport {
    pub python_available: bool,
    pub unsloth_available: bool,
    pub cuda_available: bool,
    pub vram_gb: f32,
    pub python_version: String,
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Train a LoRA adapter via the Python sidecar (Unsloth + PEFT).
/// Streams progress as Tauri events ("lora-progress").
#[tauri::command]
pub async fn train_lora(app: AppHandle, payload: LoraTrainPayload) -> Result<String, String> {
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

    let mut child = Command::new("python3")
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn Python: {e}. Is Python 3 installed?"))?;

    let stdout = child.stdout.take().ok_or("No stdout")?;
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

    let output = child
        .wait_with_output()
        .await
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok("training_completed".to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("Training failed: {}", &stderr[..stderr.len().min(500)]))
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

    let output = Command::new("python3")
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
    // Send SIGTERM to python3 processes with our script name
    #[cfg(unix)]
    {
        let _ = Command::new("pkill")
            .args(["-f", "train_writer_lora.py"])
            .output()
            .await;
    }
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/F", "/IM", "python3.exe"])
            .output()
            .await;
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
    let script_path = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("scripts")
        .join("check_lora_env.py");

    let output = Command::new("python3")
        .args([script_path.to_string_lossy().as_ref()])
        .output()
        .await;

    match output {
        Err(_) => Ok(LoraEnvReport {
            python_available: false,
            unsloth_available: false,
            cuda_available: false,
            vram_gb: 0.0,
            python_version: String::new(),
        }),
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            serde_json::from_str::<LoraEnvReport>(&stdout).map_err(|e| e.to_string())
        }
    }
}
