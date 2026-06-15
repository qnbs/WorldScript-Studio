//! Optional Pandoc bridge — EPUB from Markdown via temp dir.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use std::fs;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PandocEpubResponse {
    pub base64: String,
}

#[tauri::command]
pub fn pandoc_markdown_to_epub(markdown: String) -> Result<PandocEpubResponse, String> {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();

    let tmp = std::env::temp_dir().join(format!("worldscript-pandoc-{millis}"));
    fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;

    let md_path = tmp.join("book.md");
    let epub_name = "book.epub";
    let epub_path = tmp.join(epub_name);

    fs::write(&md_path, markdown).map_err(|e| e.to_string())?;

    let status = Command::new("pandoc")
        .current_dir(&tmp)
        .arg("book.md")
        .arg("-o")
        .arg(epub_name)
        .arg("--standalone")
        .status()
        .map_err(|e| {
            format!(
                "Pandoc nicht gefunden oder nicht ausführbar ({e}). Bitte Pandoc installieren oder den Browser-/JS-Export nutzen."
            )
        })?;

    if !status.success() {
        let _ = fs::remove_dir_all(&tmp);
        return Err("Pandoc wurde mit einem Fehlercode beendet.".into());
    }

    let bytes = fs::read(&epub_path).map_err(|e| e.to_string())?;
    let _ = fs::remove_dir_all(&tmp);

    Ok(PandocEpubResponse {
        base64: STANDARD.encode(bytes),
    })
}
