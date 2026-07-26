//! Phone pairing: this screen's device identity and pair-code minting.
//!
//! The device id rides the channel viewer URL (`?device=`) so the viewer's
//! WebSocket registers this screen with the server; a paired iPhone can then
//! retarget the display with a `{"type":"switch"}` push. Codes come from
//! `POST /api/pair/new` and are shown for the user to type into the phone.

use std::fs;
use std::path::PathBuf;

use anyhow::Context;

fn id_path() -> PathBuf {
    crate::config::data_dir().join("device-id")
}

/// Stable per-install id matching the server's `[A-Za-z0-9-]{8,64}` rule.
pub fn device_id() -> String {
    let path = id_path();
    if let Ok(id) = fs::read_to_string(&path) {
        let id = id.trim().to_string();
        if !id.is_empty() {
            return id;
        }
    }
    let id = format!("linux-{:016x}{:016x}", fastrand::u64(..), fastrand::u64(..));
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(&path, &id);
    id
}

/// Mint a 6-char pairing code for this device (blocking; call off the UI
/// thread). `channel` is optional — the server also learns the channel when
/// the viewer socket attaches.
pub fn mint_code(channel: Option<&str>) -> anyhow::Result<String> {
    let mut body = serde_json::json!({ "deviceId": device_id() });
    if let Some(c) = channel {
        body["channelId"] = serde_json::json!(c);
    }
    let resp: serde_json::Value = ureq::post("https://idlescreens.com/api/pair/new")
        .set("Content-Type", "application/json")
        .send_string(&body.to_string())
        .context("pairing service unreachable")?
        .into_json()
        .context("pairing service returned invalid JSON")?;
    resp["code"]
        .as_str()
        .map(str::to_string)
        .context("pairing service response missing code")
}
