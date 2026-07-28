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

/// Always-on control socket: keeps this screen reachable for phone pushes.
///
/// The webview only holds a channel socket while a saver window is up, so an
/// idle tray-only install never registered with the relay — pairing looked
/// fine on the phone but every push came back "has not connected yet" (the
/// exact bug the macOS app hit). This runs for the life of the process,
/// re-registering the device id and surfacing `{"type":"switch"}` pushes.
pub fn spawn_control_socket(initial_channel: Option<String>, on_switch: impl Fn(String) + Send + 'static) {
    let mut channel = initial_channel.unwrap_or_else(|| "default".to_string());
    std::thread::spawn(move || {
        let mut backoff = std::time::Duration::from_secs(1);
        loop {
            let url = format!(
                "wss://idlescreens.com/c/{channel}/ws?device={}",
                device_id()
            );
            match tungstenite::connect(&url) {
                Ok((mut socket, _)) => {
                    log::info!("pair link connected on channel {channel}");
                    backoff = std::time::Duration::from_secs(1);
                    loop {
                        match socket.read() {
                            Ok(tungstenite::Message::Text(text)) => {
                                if let Some(next) = switch_target(&text) {
                                    log::info!("pair link: switch → {next}");
                                    channel = next.clone();
                                    on_switch(next);
                                    break; // reconnect on the new channel
                                }
                            }
                            Ok(_) => {}
                            Err(e) => {
                                log::debug!("pair link closed: {e}");
                                break;
                            }
                        }
                    }
                }
                Err(e) => {
                    log::debug!("pair link connect failed: {e}");
                    std::thread::sleep(backoff);
                    backoff = (backoff * 2).min(std::time::Duration::from_secs(60));
                }
            }
        }
    });
}

/// Pull the target channel out of a `{"type":"switch","channelId":"..."}` frame.
fn switch_target(text: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(text).ok()?;
    if value.get("type")?.as_str()? != "switch" {
        return None;
    }
    let id = value.get("channelId")?.as_str()?;
    (!id.is_empty()).then(|| id.to_string())
}
