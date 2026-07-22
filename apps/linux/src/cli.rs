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

    /// Restrict to one monitor by connector name (e.g. "DP-1"; development)
    #[arg(long)]
    pub output: Option<String>,

    /// Override the web bundle directory (development)
    #[arg(long)]
    pub web_root: Option<std::path::PathBuf>,

    /// Hold a Wayland idle inhibitor while showing.
    /// WARNING: on Hyprland this pauses ALL hypridle listeners (lock, DPMS, suspend).
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

#[derive(Subcommand, Debug)]
pub enum Command {
    /// Fetch, verify, and install the latest web bundle, then exit
    CheckUpdates,
}
