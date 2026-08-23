use std::{env, fs, process};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use minisign_verify::{PublicKey, Signature};

const WRONG_PUBLIC_KEY_TEXT: &str = "untrusted comment: minisign public key E7620F1842B4E81F\n";

fn usage() -> ! {
    eprintln!(concat!(
        "usage: verify-updater-artifact <tauri-public-key> <artifact> <signature> ",
        "[--expect-failure] [--tamper] [--wrong-key]"
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

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    if args.len() < 3 {
        usage();
    }

    let expect_failure = args.iter().any(|argument| argument == "--expect-failure");
    let tamper = args.iter().any(|argument| argument == "--tamper");
    let wrong_key = args.iter().any(|argument| argument == "--wrong-key");
    if args.iter().skip(3).any(|argument| {
        !matches!(
            argument.as_str(),
            "--expect-failure" | "--tamper" | "--wrong-key"
        )
    }) {
        usage();
    }

    let public_key = if wrong_key {
        let wrong_key_config = STANDARD.encode(format!(
            "{WRONG_PUBLIC_KEY_TEXT}RWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3\n"
        ));
        decode_configured_public_key(&wrong_key_config)
    } else {
        decode_configured_public_key(&args[0])
    };

    let verification = public_key.and_then(|public_key| {
        let mut artifact = fs::read(&args[1]).map_err(|error| format!("artifact read: {error}"))?;
        if tamper {
            let index = artifact.len() / 2;
            let byte = artifact
                .get_mut(index)
                .ok_or_else(|| "artifact is empty".to_string())?;
            *byte ^= 0x01;
        }

        let signature_config =
            fs::read_to_string(&args[2]).map_err(|error| format!("signature read: {error}"))?;
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
        (true, Ok(false)) | (true, Err(_)) => println!("rejected as expected"),
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
