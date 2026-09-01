//! StatusNotifier tray — manual launch, updates, quit.
//! Uses DBus only (no GTK/WebKit init).

use std::ffi::OsString;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use ksni::{MenuItem, Tray, TrayMethods};

#[derive(Clone)]
struct IdleScreensTray {
    kiosk: bool,
    /// CLI overrides (--channel, --saver, --config, ...) the tray itself was
    /// started with, forwarded to every saver it spawns — see
    /// `Cli::forwardable_args`. `OsString` so non-UTF-8 paths survive.
    forwarded_args: Vec<OsString>,
}

impl IdleScreensTray {
    fn exe(&self) -> PathBuf {
        std::env::current_exe().unwrap_or_else(|_| PathBuf::from("idle-screens-wayland"))
    }

    fn spawn_saver(&self, extra: &[&str]) {
        let mut cmd = Command::new(self.exe());
        cmd.stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        if self.kiosk {
            cmd.arg("--kiosk");
        }
        cmd.args(&self.forwarded_args);
        cmd.args(extra);
        match cmd.spawn() {
            Ok(_) => log::info!("launched saver"),
            Err(e) => log::error!("failed to launch saver: {e}"),
        }
    }

    fn spawn_background(&self, args: &[&str]) {
        let mut cmd = Command::new(self.exe());
        // Forward --config so "Check for saver updates" checks the same
        // config.toml (and thus the same [update] base_url) the tray uses.
        // Flag names are always UTF-8; the path value may not be, so it's
        // forwarded as the raw OsString.
        if let Some(pos) = self
            .forwarded_args
            .iter()
            .position(|a| a.to_str() == Some("--config"))
        {
            if let Some(path) = self.forwarded_args.get(pos + 1) {
                cmd.arg("--config").arg(path);
            }
        }
        cmd.args(args);
        if let Err(e) = cmd.spawn() {
            log::error!("spawn failed: {e}");
        }
    }

    fn open_config(&self) {
        let dir = crate::config::config_dir();
        let _ = Command::new("xdg-open").arg(&dir).spawn();
    }
}

impl Tray for IdleScreensTray {
    fn id(&self) -> String {
        "idle-screens-wayland".into()
    }

    fn title(&self) -> String {
        "idle-screens".into()
    }

    fn icon_name(&self) -> String {
        "preferences-desktop-screensaver".into()
    }

    fn menu(&self) -> Vec<MenuItem<Self>> {
        use ksni::menu::StandardItem;
        vec![
            MenuItem::Standard(StandardItem {
                label: "Show saver now".into(),
                icon_name: "media-playback-start".into(),
                activate: Box::new(|this: &mut Self| this.spawn_saver(&[])),
                ..Default::default()
            }),
            MenuItem::Standard(StandardItem {
                label: "Show saver (kiosk)".into(),
                icon_name: "view-fullscreen".into(),
                activate: Box::new(|this: &mut Self| this.spawn_saver(&["--kiosk"])),
                ..Default::default()
            }),
            // Pairing belongs with the primary actions, not below the
            // maintenance items — it's something you reach for, not upkeep.
            MenuItem::Standard(StandardItem {
                label: "Pair phone".into(),
                icon_name: "phone".into(),
                activate: Box::new(|_this: &mut Self| {
                    // Blocking HTTP — keep it off the tray's reactor thread.
                    std::thread::spawn(|| match crate::pair::mint_code(None) {
                        Ok(code) => {
                            log::info!("pairing code: {code}");
                            let _ = std::process::Command::new("notify-send")
                                .arg("idle screens — pair phone")
                                .arg(format!(
                                    "Enter {code} in the idle screens iPhone app \
                                         (TV tab). Expires in 5 minutes."
                                ))
                                .spawn();
                        }
                        Err(e) => {
                            log::warn!("pairing failed: {e:#}");
                            let _ = std::process::Command::new("notify-send")
                                .arg("idle screens — pairing failed")
                                .arg(e.to_string())
                                .spawn();
                        }
                    });
                }),
                ..Default::default()
            }),
            MenuItem::Separator,
            MenuItem::Standard(StandardItem {
                label: "Check for saver updates".into(),
                icon_name: "system-software-update".into(),
                activate: Box::new(|this: &mut Self| {
                    this.spawn_background(&["check-updates"]);
                }),
                ..Default::default()
            }),
            MenuItem::Standard(StandardItem {
                label: "Open config folder".into(),
                icon_name: "folder-open".into(),
                activate: Box::new(|this: &mut Self| this.open_config()),
                ..Default::default()
            }),
            MenuItem::Standard(StandardItem {
                label: "About".into(),
                icon_name: "help-about".into(),
                activate: Box::new(|_this: &mut Self| {
                    let summary = crate::about::summary();
                    log::info!("{summary}");
                    let _ = std::process::Command::new("notify-send")
                        .arg("idle screens")
                        .arg(&summary)
                        .spawn();
                }),
                ..Default::default()
            }),
            MenuItem::Separator,
            MenuItem::Standard(StandardItem {
                label: "Quit tray".into(),
                icon_name: "application-exit".into(),
                activate: Box::new(|_| std::process::exit(0)),
                ..Default::default()
            }),
        ]
    }
}

pub fn run(kiosk_default: bool, forwarded_args: Vec<OsString>) -> anyhow::Result<()> {
    let tray = IdleScreensTray {
        kiosk: kiosk_default,
        forwarded_args,
    };
    log::info!("starting status notifier tray");

    // Keep this screen reachable for phone pushes for as long as the tray
    // runs — without it a paired phone's pushes 409 ("not connected yet").
    crate::pair::spawn_control_socket(None, |channel| {
        log::info!("pushed to channel {channel}; launching saver");
        let exe = std::env::current_exe()
            .unwrap_or_else(|_| std::path::PathBuf::from("idle-screens-wayland"));
        let _ = Command::new(exe)
            .args(["--channel", &channel])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();
    });

    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;

    rt.block_on(async {
        let _handle = spawn_with_retry(tray).await?;
        log::info!("tray ready (Waybar / SNI host required)");
        std::future::pending::<()>().await;
        #[allow(unreachable_code)]
        Ok::<(), anyhow::Error>(())
    })
}

/// How long to keep waiting for a StatusNotifierWatcher to appear.
const REGISTER_DEADLINE: Duration = Duration::from_secs(300);
/// Backoff bounds between registration attempts.
const RETRY_START: Duration = Duration::from_millis(250);
const RETRY_MAX: Duration = Duration::from_secs(15);

/// Register with the SNI host, retrying while the bus name is missing.
///
/// On login the tray is started by XDG autostart, which under uwsm/systemd
/// races the bar that owns `org.kde.StatusNotifierWatcher` — Quickshell on
/// Omarchy. A single attempt loses that race and the process exits 1
/// ("The name is not activatable"), so the tray silently never appears.
async fn spawn_with_retry(tray: IdleScreensTray) -> anyhow::Result<ksni::Handle<IdleScreensTray>> {
    let deadline = Instant::now() + REGISTER_DEADLINE;
    let mut backoff = RETRY_START;
    let mut attempt = 0u32;
    loop {
        attempt += 1;
        // ksni consumes the tray on spawn, so hand it a clone per attempt.
        match tray.clone().spawn().await {
            Ok(handle) => {
                if attempt > 1 {
                    log::info!("tray registered after {attempt} attempts");
                }
                return Ok(handle);
            }
            Err(e) if Instant::now() < deadline => {
                if attempt == 1 {
                    log::info!("no StatusNotifierWatcher yet ({e}); waiting for a bar to start");
                }
                tokio::time::sleep(backoff).await;
                backoff = (backoff * 2).min(RETRY_MAX);
            }
            Err(e) => {
                return Err(anyhow::anyhow!(
                    "tray: failed to register after {attempt} attempts over {}s: {e}",
                    REGISTER_DEADLINE.as_secs()
                ));
            }
        }
    }
}
