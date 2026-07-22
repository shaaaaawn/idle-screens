//! StatusNotifier tray — manual launch, updates, quit.
//! Uses DBus only (no GTK/WebKit init).

use std::ffi::OsString;
use std::path::PathBuf;
use std::process::{Command, Stdio};

use ksni::{MenuItem, Tray, TrayMethods};

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

    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;

    rt.block_on(async {
        let _handle = tray
            .spawn()
            .await
            .map_err(|e| anyhow::anyhow!("tray: {e}"))?;
        log::info!("tray ready (Waybar / SNI host required)");
        std::future::pending::<()>().await;
        #[allow(unreachable_code)]
        Ok::<(), anyhow::Error>(())
    })
}
