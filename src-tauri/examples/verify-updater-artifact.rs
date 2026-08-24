use std::{env, fs, path::PathBuf, process};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use minisign_verify::{PublicKey, Signature};

const WRONG_PUBLIC_KEY_TEXT: &str = "untrusted comment: minisign public key E7620F1842B4E81F\n";

fn usage() -> ! {
    eprintln!(concat!(
        "usage: verify-updater-artifact <artifact> <signature-file-or-manifest> ",
        "[--manifest-platform <platform>] [--expect-failure] [--tamper] [--wrong-key]"
    ));
    process::exit(2);
}

fn decode_configured_public_key(encoded: &str) -> Result<PublicKey, String> {
    let decoded = STANDARD
        .decode(encoded)
        .map_err(|error| format!("public-key base64: {error}"))?;
    let text = String::from_utf8(decoded).map_err(|error| format!("public-key text: {error}"))?;
    PublicKey::decode(&text).map_err(|error| format!("public-key minisign encoding: {error:?}"))
}

// QNBS-v3: bind audit verification to the production updater key and published manifest data.
fn configured_public_key() -> Result<PublicKey, String> {
    let config_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json");
    let config_text =
        fs::read_to_string(&config_path).map_err(|error| format!("Tauri config read: {error}"))?;
    let config: serde_json::Value = serde_json::from_str(&config_text)
        .map_err(|error| format!("Tauri config JSON: {error}"))?;
    let encoded_key = config
        .pointer("/plugins/updater/pubkey")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "Tauri config updater.pubkey is missing or not a string".to_string())?;
    decode_configured_public_key(encoded_key)
}

fn signature_source(path: &str, manifest_platform: Option<&str>) -> Result<String, String> {
    let source =
        fs::read_to_string(path).map_err(|error| format!("signature source read: {error}"))?;
    let Some(platform) = manifest_platform else {
        return Ok(source);
    };

    let manifest: serde_json::Value =
        serde_json::from_str(&source).map_err(|error| format!("latest.json JSON: {error}"))?;
    manifest
        .get("platforms")
        .and_then(serde_json::Value::as_object)
        .and_then(|platforms| platforms.get(platform))
        .and_then(serde_json::Value::as_object)
        .and_then(|entry| entry.get("signature"))
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| format!("latest.json signature missing for platform {platform}"))
}

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    if args.len() < 2 {
        usage();
    }

    let mut expect_failure = false;
    let mut tamper = false;
    let mut wrong_key = false;
    let mut manifest_platform = None;
    let mut option_index = 2;
    while option_index < args.len() {
        match args[option_index].as_str() {
            "--expect-failure" => expect_failure = true,
            "--tamper" => tamper = true,
            "--wrong-key" => wrong_key = true,
            "--manifest-platform" => {
                let Some(platform) = args.get(option_index + 1) else {
                    usage();
                };
                if platform.starts_with("--") {
                    usage();
                }
                manifest_platform = Some(platform.as_str());
                option_index += 1;
            }
            _ => usage(),
        }
        option_index += 1;
    }

    let public_key = if wrong_key {
        let wrong_key_config = STANDARD.encode(format!(
            "{WRONG_PUBLIC_KEY_TEXT}RWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3\n"
        ));
        decode_configured_public_key(&wrong_key_config)
    } else {
        configured_public_key()
    };

    let verification = public_key.and_then(|public_key| {
        let mut artifact = fs::read(&args[0]).map_err(|error| format!("artifact read: {error}"))?;
        if tamper {
            let index = artifact.len() / 2;
            let byte = artifact
                .get_mut(index)
                .ok_or_else(|| "artifact is empty".to_string())?;
            *byte ^= 0x01;
        }

        let signature_config = signature_source(&args[1], manifest_platform)?;
        let signature_text = STANDARD
            .decode(signature_config.trim())
            .map_err(|error| format!("signature base64: {error}"))
            .and_then(|decoded| {
                String::from_utf8(decoded).map_err(|error| format!("signature text: {error}"))
            })?;
        let signature = Signature::decode(&signature_text)
            .map_err(|error| format!("signature minisign encoding: {error:?}"))?;

        Ok::<bool, String>(public_key.verify(&artifact, &signature, true).is_ok())
    });

    match (expect_failure, verification) {
        (false, Ok(true)) => println!("verified"),
        (true, Ok(false)) => println!("rejected as expected"),
        (true, Err(error)) => {
            eprintln!("verification error in negative test: {error}");
            process::exit(1);
        }
        (false, Ok(false)) => {
            eprintln!("signature rejected");
            process::exit(1);
        }
        (false, Err(error)) => {
            eprintln!("verification error: {error}");
            process::exit(1);
        }
        (true, Ok(true)) => {
            eprintln!("expected verification failure, but signature was accepted");
            process::exit(1);
        }
    }
}
