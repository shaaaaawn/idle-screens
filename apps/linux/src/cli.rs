use std::ffi::OsString;

use clap::{Parser, Subcommand};

/// idle-screens screensaver overlay for Wayland/Hyprland.
///
/// Running the binary shows the saver immediately (hypridle execs it on idle);
/// it exits on user input or SIGTERM.
#[derive(Parser, Debug)]
#[command(name = "idle-screens-wayland", version, about)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Option<Command>,

    /// Channel id (e.g. "ballet") or full URL to stream instead of bundled savers
    #[arg(long)]
    pub channel: Option<String>,

    /// Pin one bundled saver by id (e.g. "warp")
    #[arg(long)]
    pub saver: Option<String>,

    /// Cycle interval in minutes for bundled savers (0 disables)
    #[arg(long)]
    pub cycle: Option<i64>,

    /// Dim the saver (0.1..=1.0)
    #[arg(long)]
    pub brightness: Option<f64>,

    /// Fixed session seed (default: random; all monitors share it)
    #[arg(long)]
    pub seed: Option<u32>,

    /// Open a normal window instead of a fullscreen overlay (development)
    #[arg(long)]
    pub windowed: bool,

    /// Fullscreen overlay that ignores mouse/keyboard for exit (kiosk / demo).
    /// Pair with a hypridle listener that omits on-resume — see packaging/hypridle-kiosk.conf.example.
    #[arg(long)]
    pub kiosk: bool,

    /// Restrict to one monitor by connector name (e.g. "DP-1"; development)
    #[arg(long)]
    pub output: Option<String>,

    /// Override the web bundle directory (development)
    #[arg(long)]
    pub web_root: Option<std::path::PathBuf>,

    /// Reserved: not yet implemented (currently a no-op, only logs a warning).
    /// Would hold a Wayland idle inhibitor while showing — WARNING: on
    /// Hyprland that pauses ALL hypridle listeners (lock, DPMS, suspend).
    #[arg(long)]
    pub inhibit: bool,

    /// Skip the launch-time bundle update check
    #[arg(long)]
    pub no_update_check: bool,

    /// Alternate config file (default: ~/.config/idle-screens/config.toml)
    #[arg(long)]
    pub config: Option<std::path::PathBuf>,

    /// Verbose (debug) logging
    #[arg(short, long)]
    pub verbose: bool,
}

impl Cli {
    /// Overrides that should carry through to a saver process the tray
    /// spawns, so `idle-screens-wayland --channel foo tray` keeps applying
    /// `--channel foo` to every "Show saver now" launch, not just the tray
    /// itself. `--kiosk` is handled separately by the caller (it toggles
    /// per menu item, not just per tray session).
    ///
    /// Returns `OsString`s so `--web-root` / `--config` paths forward
    /// losslessly — `display().to_string()` would mangle non-UTF-8 paths.
    pub fn forwardable_args(&self) -> Vec<OsString> {
        let mut args: Vec<OsString> = Vec::new();
        if let Some(v) = &self.channel {
            args.push("--channel".into());
            args.push(v.into());
        }
        if let Some(v) = &self.saver {
            args.push("--saver".into());
            args.push(v.into());
        }
        if let Some(v) = self.cycle {
            args.push("--cycle".into());
            args.push(v.to_string().into());
        }
        if let Some(v) = self.brightness {
            args.push("--brightness".into());
            args.push(v.to_string().into());
        }
        if let Some(v) = self.seed {
            args.push("--seed".into());
            args.push(v.to_string().into());
        }
        if let Some(v) = &self.web_root {
            args.push("--web-root".into());
            args.push(v.clone().into_os_string());
        }
        if let Some(v) = &self.config {
            args.push("--config".into());
            args.push(v.clone().into_os_string());
        }
        if self.no_update_check {
            args.push("--no-update-check".into());
        }
        args
    }
}

#[derive(Subcommand, Debug)]
pub enum Command {
    /// Fetch, verify, and install the latest web bundle, then exit
    CheckUpdates,
    /// Run a StatusNotifier tray (manual launch, updates, quit)
    Tray,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn forwardable_args_is_empty_by_default() {
        let cli = Cli::parse_from(["idle-screens-wayland", "tray"]);
        assert!(cli.forwardable_args().is_empty());
    }

    #[test]
    fn forwardable_args_carries_channel_and_config_to_tray_launches() {
        let cli = Cli::parse_from([
            "idle-screens-wayland",
            "--channel",
            "ballet",
            "--config",
            "/tmp/custom.toml",
            "--no-update-check",
            "tray",
        ]);
        // Inputs are all UTF-8, so lossy stringification is exact here — the
        // OsString return type only matters for non-UTF-8 paths.
        let args: Vec<String> = cli
            .forwardable_args()
            .iter()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        assert_eq!(
            args,
            vec![
                "--channel",
                "ballet",
                "--config",
                "/tmp/custom.toml",
                "--no-update-check"
            ]
        );
    }

    #[test]
    fn forwardable_args_excludes_session_only_flags() {
        // --kiosk, --windowed, --output, --inhibit, -v are session-specific;
        // the tray/spawn_saver caller handles --kiosk on its own.
        let cli = Cli::parse_from([
            "idle-screens-wayland",
            "--kiosk",
            "--windowed",
            "--output",
            "DP-1",
            "--inhibit",
            "-v",
            "tray",
        ]);
        assert!(cli.forwardable_args().is_empty());
    }
}
