use std::path::PathBuf;

use anyhow::Context;
use serde::Deserialize;

use crate::cli::Cli;

pub const DEFAULT_UPDATE_BASE: &str = "https://idlescreens.com/mac/";
pub const CHANNEL_BASE: &str = "https://idlescreens.com/channel/";

/// Raw TOML shape — every key optional so a partial (or absent) file is fine.
#[derive(Deserialize, Default, Debug)]
#[serde(deny_unknown_fields)]
struct FileConfig {
    mode: Option<String>,
    channel: Option<String>,
    saver: Option<String>,
    cycle_minutes: Option<i64>,
    brightness: Option<f64>,
    hints: Option<bool>,
    inhibit: Option<bool>,
    fade_ms: Option<u64>,
    #[serde(default)]
    webkit: WebkitConfig,
    #[serde(default)]
    update: UpdateConfig,
}

#[derive(Deserialize, Default, Debug)]
#[serde(deny_unknown_fields)]
struct WebkitConfig {
    disable_dmabuf: Option<String>,
}

#[derive(Deserialize, Default, Debug)]
#[serde(deny_unknown_fields)]
struct UpdateConfig {
    check: Option<String>,
    base_url: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Mode {
    /// Bundled offline saver engine (file:// web bundle).
    Savers,
    /// Live channel viewer (remote URL, WebSocket-steered).
    Channel(String),
}

#[derive(Clone, Debug, PartialEq)]
pub enum DmabufPolicy {
    Auto,
    Always,
    Never,
}

/// Fully-resolved settings. Precedence: CLI flag > config file > default.
#[derive(Clone, Debug)]
pub struct Settings {
    pub mode: Mode,
    pub saver: Option<String>,
    pub cycle_minutes: i64,
    pub brightness: f64,
    pub hints: bool,
    pub inhibit: bool,
    pub fade_ms: u64,
    pub windowed: bool,
    pub output: Option<String>,
    pub web_root_override: Option<PathBuf>,
    pub seed: Option<u32>,
    pub dmabuf: DmabufPolicy,
    pub update_on_launch: bool,
    pub update_base_url: String,
}

impl Settings {
    pub fn load(cli: &Cli) -> anyhow::Result<Self> {
        let path = cli
            .config
            .clone()
            .unwrap_or_else(|| config_dir().join("config.toml"));
        let file: FileConfig = match std::fs::read_to_string(&path) {
            Ok(text) => {
                toml::from_str(&text).with_context(|| format!("parsing {}", path.display()))?
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => FileConfig::default(),
            Err(e) => return Err(e).with_context(|| format!("reading {}", path.display())),
        };
        Ok(Self::merge(cli, file))
    }

    fn merge(cli: &Cli, file: FileConfig) -> Self {
        let channel_choice = cli.channel.clone().or_else(|| {
            if file.mode.as_deref() == Some("channel") {
                file.channel.clone().filter(|c| !c.is_empty())
            } else {
                None
            }
        });
        let mode = match channel_choice {
            Some(c) => Mode::Channel(resolve_channel_url(&c)),
            None => Mode::Savers,
        };

        let dmabuf = match file.webkit.disable_dmabuf.as_deref() {
            Some("always") => DmabufPolicy::Always,
            Some("never") => DmabufPolicy::Never,
            _ => DmabufPolicy::Auto,
        };

        let brightness = cli
            .brightness
            .or(file.brightness)
            .unwrap_or(1.0)
            .clamp(0.1, 1.0);

        Settings {
            mode,
            saver: cli
                .saver
                .clone()
                .or_else(|| file.saver.clone().filter(|s| !s.is_empty())),
            cycle_minutes: cli.cycle.or(file.cycle_minutes).unwrap_or(10),
            brightness,
            hints: file.hints.unwrap_or(true),
            inhibit: cli.inhibit || file.inhibit.unwrap_or(false),
            fade_ms: file.fade_ms.unwrap_or(900),
            windowed: cli.windowed,
            output: cli.output.clone(),
            web_root_override: cli.web_root.clone(),
            seed: cli.seed,
            dmabuf,
            update_on_launch: !cli.no_update_check
                && file.update.check.as_deref().unwrap_or("launch") == "launch",
            update_base_url: file
                .update
                .base_url
                .unwrap_or_else(|| DEFAULT_UPDATE_BASE.to_string()),
        }
    }
}

/// A channel value is either a bare id ("ballet") or a full URL passed through.
pub fn resolve_channel_url(channel: &str) -> String {
    if channel.contains("://") {
        channel.to_string()
    } else {
        format!("{CHANNEL_BASE}{channel}")
    }
}

pub fn config_dir() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("idle-screens")
}

pub fn data_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("idle-screens")
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::Parser;

    fn cli(args: &[&str]) -> Cli {
        Cli::parse_from(std::iter::once("idle-screens-wayland").chain(args.iter().copied()))
    }

    #[test]
    fn defaults_to_savers_mode() {
        let s = Settings::merge(&cli(&[]), FileConfig::default());
        assert_eq!(s.mode, Mode::Savers);
        assert_eq!(s.cycle_minutes, 10);
        assert!(s.hints);
        assert!(!s.inhibit);
        assert_eq!(s.fade_ms, 900);
    }

    #[test]
    fn cli_channel_overrides_config_mode() {
        let file: FileConfig = toml::from_str("mode = \"savers\"").unwrap();
        let s = Settings::merge(&cli(&["--channel", "ballet"]), file);
        assert_eq!(
            s.mode,
            Mode::Channel("https://idlescreens.com/channel/ballet".into())
        );
    }

    #[test]
    fn config_channel_mode_needs_channel_key() {
        let file: FileConfig = toml::from_str("mode = \"channel\"").unwrap();
        assert_eq!(Settings::merge(&cli(&[]), file).mode, Mode::Savers);
        let file: FileConfig = toml::from_str("mode = \"channel\"\nchannel = \"lobby\"").unwrap();
        assert_eq!(
            Settings::merge(&cli(&[]), file).mode,
            Mode::Channel("https://idlescreens.com/channel/lobby".into())
        );
    }

    #[test]
    fn full_channel_url_passes_through() {
        assert_eq!(
            resolve_channel_url("https://example.com/x"),
            "https://example.com/x"
        );
        assert_eq!(
            resolve_channel_url("ballet"),
            "https://idlescreens.com/channel/ballet"
        );
    }

    #[test]
    fn brightness_is_clamped() {
        let s = Settings::merge(&cli(&["--brightness", "0.01"]), FileConfig::default());
        assert!((s.brightness - 0.1).abs() < f64::EPSILON);
        let s = Settings::merge(&cli(&["--brightness", "5"]), FileConfig::default());
        assert!((s.brightness - 1.0).abs() < f64::EPSILON);
    }

    #[test]
    fn update_check_toggles() {
        let s = Settings::merge(&cli(&["--no-update-check"]), FileConfig::default());
        assert!(!s.update_on_launch);
        let file: FileConfig = toml::from_str("[update]\ncheck = \"never\"").unwrap();
        assert!(!Settings::merge(&cli(&[]), file).update_on_launch);
        let s = Settings::merge(&cli(&[]), FileConfig::default());
        assert!(s.update_on_launch);
    }
}
