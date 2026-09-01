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
    /// The file the settings items write to.
    config_path: PathBuf,
    /// Last-known config, refreshed every time the menu opens so the checks
    /// and radios reflect edits made outside the tray (a text editor, another
    /// machine syncing the file) rather than a stale in-memory copy.
    settings: crate::config::Settings,
    /// Bundle catalog, for the saver picker.
    savers: Vec<crate::bundle::SaverEntry>,
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

    fn open_config_folder(&self) {
        let dir = crate::config::config_dir();
        let _ = Command::new("xdg-open").arg(&dir).spawn();
    }

    /// Open config.toml in the user's editor.
    ///
    /// `omarchy-launch-editor` first: it is the desktop's own indirection for
    /// "the editor I chose" and already knows to wrap a terminal editor in a
    /// terminal, which plain `$EDITOR` from a tray process does not. Then
    /// `$VISUAL` (GUI by convention, unlike `$EDITOR`), then known GUI
    /// editors, and finally xdg-open -- whose text/plain default is often a
    /// terminal editor that cannot launch without one.
    fn edit_config(&self) {
        let path = self.config_path.clone();
        let visual = std::env::var("VISUAL")
            .ok()
            .filter(|v| !v.trim().is_empty());
        std::thread::spawn(move || {
            let mut candidates: Vec<Vec<String>> = vec![vec!["omarchy-launch-editor".into()]];
            if let Some(v) = visual {
                // $VISUAL may carry flags ("code -w"); split on whitespace.
                candidates.push(v.split_whitespace().map(String::from).collect());
            }
            for gui in ["cursor", "code", "zed", "gnome-text-editor"] {
                candidates.push(vec![gui.into()]);
            }
            candidates.push(vec!["xdg-open".into()]);

            for argv in candidates {
                let Some((prog, args)) = argv.split_first() else {
                    continue;
                };
                if which(prog).is_none() {
                    continue;
                }
                let spawned = Command::new(prog)
                    .args(args)
                    .arg(&path)
                    .stdin(Stdio::null())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .spawn();
                match spawned {
                    Ok(_) => {
                        log::info!("opened {} in {prog}", path.display());
                        return;
                    }
                    Err(e) => log::warn!("could not launch {prog}: {e}"),
                }
            }
            log::error!("no editor found for {}", path.display());
        });
    }

    /// Write one config key, then refresh the in-memory copy so the menu
    /// redraws with the new state (ksni propagates changes made here).
    fn set_config(&mut self, key: &str, value: crate::config_write::Setting) {
        if let Err(e) = crate::config_write::set(&self.config_path, key, value) {
            log::error!("config write failed: {e:#}");
            let _ = Command::new("notify-send")
                .arg("idle screens — could not save setting")
                .arg(e.to_string())
                .spawn();
            return;
        }
        self.reload_settings();
    }

    fn reload_settings(&mut self) {
        // Re-read through the same precedence rules a saver launch uses, so
        // the menu shows what would actually happen, not just the file.
        let cli = crate::cli::Cli::for_config(self.config_path.clone());
        match crate::config::Settings::load(&cli) {
            Ok(s) => self.settings = s,
            Err(e) => log::warn!("could not reload config: {e:#}"),
        }
    }

    /// The channel this config would use, whichever mode is active.
    fn channel_name(&self) -> Option<String> {
        crate::config_write::get_str(&self.config_path, "channel").filter(|c| !c.is_empty())
    }

    fn in_channel_mode(&self) -> bool {
        matches!(self.settings.mode, crate::config::Mode::Channel(_))
    }
}

/// Minimal PATH lookup -- avoids a `which` dependency for one call site.
fn which(prog: &str) -> Option<PathBuf> {
    if prog.contains('/') {
        let p = PathBuf::from(prog);
        return p.is_file().then_some(p);
    }
    std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths)
            .map(|dir| dir.join(prog))
            .find(|p| p.is_file())
    })
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

    /// Left click: the thing you opened the tray for.
    fn activate(&mut self, _x: i32, _y: i32) {
        self.spawn_saver(&[]);
    }

    /// Middle click: the same, held until dismissed.
    fn secondary_activate(&mut self, _x: i32, _y: i32) {
        self.spawn_saver(&["--kiosk"]);
    }

    fn tool_tip(&self) -> ksni::ToolTip {
        let state = if let Some(channel) = self.channel_name().filter(|_| self.in_channel_mode()) {
            format!("Channel · {channel}")
        } else if let Some(saver) = &self.settings.saver {
            format!("Saver · {saver}")
        } else if self.settings.cycle_minutes > 0 {
            format!("Shuffling every {} min", self.settings.cycle_minutes)
        } else {
            "Shuffling".to_string()
        };
        ksni::ToolTip {
            title: "idle screens".into(),
            description: format!("{state}\nClick to show the saver now"),
            icon_name: self.icon_name(),
            icon_pixmap: Vec::new(),
        }
    }

    /// Re-read the config each time the menu opens, so edits made in an editor
    /// (or by another machine) are reflected instead of a stale copy.
    fn menu_about_to_show(&mut self) {
        self.reload_settings();
    }

    fn menu(&self) -> Vec<MenuItem<Self>> {
        use ksni::menu::{CheckmarkItem, RadioGroup, RadioItem, StandardItem, SubMenu};

        let channel = self.channel_name();
        let in_channel = self.in_channel_mode();

        // ---- Mode: offline bundle vs live channel -------------------------
        let mode_label = match (&channel, in_channel) {
            (Some(c), true) => format!("Mode · channel ({c})"),
            _ => "Mode · savers".to_string(),
        };
        let channel_option = match &channel {
            Some(c) => format!("Channel: {c}"),
            None => "Channel (none set)".into(),
        };
        let mode_menu = MenuItem::SubMenu(SubMenu {
            label: mode_label,
            icon_name: "network-wireless-symbolic".into(),
            submenu: vec![MenuItem::RadioGroup(RadioGroup {
                selected: usize::from(in_channel),
                select: Box::new(|this: &mut Self, i| {
                    let mode = if i == 1 { "channel" } else { "savers" };
                    this.set_config("mode", crate::config_write::Setting::Str(mode.into()));
                }),
                options: vec![
                    RadioItem {
                        label: "Savers (offline)".into(),
                        ..Default::default()
                    },
                    RadioItem {
                        label: channel_option,
                        // Selecting channel mode without a channel would just
                        // fall back to savers -- see config.rs merge().
                        enabled: channel.is_some(),
                        ..Default::default()
                    },
                ],
            })],
            ..Default::default()
        });

        // ---- Saver: pin one, or shuffle the catalog -----------------------
        let pinned = self.settings.saver.clone();
        let selected_saver = pinned
            .as_ref()
            .and_then(|id| self.savers.iter().position(|s| &s.id == id).map(|i| i + 1))
            .unwrap_or(0);
        let mut saver_options = vec![RadioItem {
            label: "Shuffle all".into(),
            ..Default::default()
        }];
        saver_options.extend(self.savers.iter().map(|s| RadioItem {
            label: s.label.clone(),
            ..Default::default()
        }));
        let ids: Vec<String> = self.savers.iter().map(|s| s.id.clone()).collect();
        let saver_menu = MenuItem::SubMenu(SubMenu {
            label: match &pinned {
                Some(id) => format!("Saver · {id}"),
                None => "Saver · shuffle".into(),
            },
            icon_name: "view-list-symbolic".into(),
            submenu: vec![MenuItem::RadioGroup(RadioGroup {
                selected: selected_saver,
                select: Box::new(move |this: &mut Self, i| {
                    let setting = match i.checked_sub(1).and_then(|i| ids.get(i)) {
                        Some(id) => crate::config_write::Setting::Str(id.clone()),
                        // "Shuffle all" removes the pin rather than writing a
                        // sentinel, so the built-in default applies again.
                        None => crate::config_write::Setting::Unset,
                    };
                    this.set_config("saver", setting);
                }),
                options: saver_options,
            })],
            enabled: !self.savers.is_empty(),
            ..Default::default()
        });

        // ---- Brightness ---------------------------------------------------
        const BRIGHTNESS: [(&str, f64); 4] = [
            ("Full", 1.0),
            ("Dim (75%)", 0.75),
            ("Dimmer (50%)", 0.5),
            ("Night (25%)", 0.25),
        ];
        let current_brightness = BRIGHTNESS
            .iter()
            .position(|(_, v)| (self.settings.brightness - v).abs() < 0.01)
            .unwrap_or(0);
        let brightness_menu = MenuItem::SubMenu(SubMenu {
            label: format!(
                "Brightness · {}%",
                (self.settings.brightness * 100.0).round()
            ),
            icon_name: "display-brightness-symbolic".into(),
            submenu: vec![MenuItem::RadioGroup(RadioGroup {
                selected: current_brightness,
                select: Box::new(|this: &mut Self, i| {
                    let value = BRIGHTNESS.get(i).map(|(_, v)| *v).unwrap_or(1.0);
                    this.set_config("brightness", crate::config_write::Setting::Float(value));
                }),
                options: BRIGHTNESS
                    .iter()
                    .map(|(label, _)| RadioItem {
                        label: (*label).into(),
                        ..Default::default()
                    })
                    .collect(),
            })],
            ..Default::default()
        });

        // ---- Cycle --------------------------------------------------------
        const CYCLE: [(&str, i64); 5] = [
            ("Never", 0),
            ("Every 2 min", 2),
            ("Every 5 min", 5),
            ("Every 10 min", 10),
            ("Every 30 min", 30),
        ];
        let current_cycle = CYCLE
            .iter()
            .position(|(_, v)| *v == self.settings.cycle_minutes)
            .unwrap_or(0);
        let cycle_menu = MenuItem::SubMenu(SubMenu {
            label: if self.settings.cycle_minutes > 0 {
                format!("Change every · {} min", self.settings.cycle_minutes)
            } else {
                "Change every · never".into()
            },
            icon_name: "media-playlist-repeat-symbolic".into(),
            submenu: vec![MenuItem::RadioGroup(RadioGroup {
                selected: current_cycle,
                select: Box::new(|this: &mut Self, i| {
                    let value = CYCLE.get(i).map(|(_, v)| *v).unwrap_or(10);
                    this.set_config("cycle_minutes", crate::config_write::Setting::Int(value));
                }),
                options: CYCLE
                    .iter()
                    .map(|(label, _)| RadioItem {
                        label: (*label).into(),
                        ..Default::default()
                    })
                    .collect(),
            })],
            // Pinning one saver makes cycling meaningless.
            enabled: self.settings.saver.is_none(),
            ..Default::default()
        });

        vec![
            MenuItem::Standard(StandardItem {
                label: "Show saver".into(),
                icon_name: "media-playback-start-symbolic".into(),
                activate: Box::new(|this: &mut Self| this.spawn_saver(&[])),
                ..Default::default()
            }),
            MenuItem::Standard(StandardItem {
                label: "Show until dismissed".into(),
                icon_name: "view-fullscreen-symbolic".into(),
                activate: Box::new(|this: &mut Self| this.spawn_saver(&["--kiosk"])),
                ..Default::default()
            }),
            MenuItem::Separator,
            mode_menu,
            saver_menu,
            brightness_menu,
            cycle_menu,
            MenuItem::Checkmark(CheckmarkItem {
                label: "Show saver name".into(),
                checked: self.settings.hints,
                activate: Box::new(|this: &mut Self| {
                    let next = !this.settings.hints;
                    this.set_config("hints", crate::config_write::Setting::Bool(next));
                }),
                ..Default::default()
            }),
            MenuItem::Separator,
            MenuItem::Standard(StandardItem {
                label: "Pair phone".into(),
                icon_name: "phone-symbolic".into(),
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
            MenuItem::Standard(StandardItem {
                // Was "Check for saver updates" -- long enough that the bar
                // truncated it to "Check for saver upda…".
                label: "Check for updates".into(),
                icon_name: "software-update-available-symbolic".into(),
                activate: Box::new(|this: &mut Self| {
                    this.spawn_background(&["check-updates"]);
                }),
                ..Default::default()
            }),
            MenuItem::Separator,
            MenuItem::Standard(StandardItem {
                label: "Edit config…".into(),
                icon_name: "document-edit-symbolic".into(),
                activate: Box::new(|this: &mut Self| this.edit_config()),
                ..Default::default()
            }),
            MenuItem::Standard(StandardItem {
                label: "Open config folder".into(),
                icon_name: "folder-open-symbolic".into(),
                activate: Box::new(|this: &mut Self| this.open_config_folder()),
                ..Default::default()
            }),
            MenuItem::Standard(StandardItem {
                label: "About".into(),
                icon_name: "help-about-symbolic".into(),
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
                icon_name: "application-exit-symbolic".into(),
                activate: Box::new(|_| std::process::exit(0)),
                ..Default::default()
            }),
        ]
    }
}

pub fn run(cli: &crate::cli::Cli) -> anyhow::Result<()> {
    let config_path = crate::config::config_path(cli);
    let settings = crate::config::Settings::load(cli)?;
    let savers = crate::bundle::saver_list(&settings);
    log::info!("tray: {} savers in catalog", savers.len());
    let tray = IdleScreensTray {
        kiosk: cli.kiosk,
        forwarded_args: cli.forwardable_args(),
        config_path,
        settings,
        savers,
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
