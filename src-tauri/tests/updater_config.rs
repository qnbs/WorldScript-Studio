//! The shipped updater must reject an update whose signature does not bind the announced version
//! (#1215). The flags are read through the plugin's own `Config` deserializer, so a misspelt key,
//! which serde would silently default to `false`, fails here instead of shipping unenforced.

const TAURI_CONF: &str = include_str!("../tauri.conf.json");

fn shipped_updater_config() -> tauri_plugin_updater::Config {
    let conf: serde_json::Value = serde_json::from_str(TAURI_CONF).expect("tauri.conf.json parses");
    let updater = conf["plugins"]["updater"].clone();
    serde_json::from_value(updater).expect("plugins.updater deserializes as the plugin's Config")
}

#[test]
fn shipped_updater_requires_a_signed_version() {
    assert!(shipped_updater_config().require_signed_version);
}

#[test]
fn shipped_updater_keeps_downgrades_and_insecure_transport_off() {
    let config = shipped_updater_config();
    assert!(!config.allow_downgrades);
    assert!(!config.dangerous_insecure_transport_protocol);
    assert!(!config.dangerous_accept_invalid_certs);
    assert!(!config.dangerous_accept_invalid_hostnames);
}
