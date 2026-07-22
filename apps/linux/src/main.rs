mod bundle;
mod cli;
mod config;
mod idle;
mod platform;
mod state;
mod webview;
mod windows;

use clap::Parser;
use glib_unix::unix_signal_add_local;
use gtk4 as gtk;
use gtk4::glib;
use gtk4::prelude::*;

use crate::config::{Mode, Settings};

fn main() -> anyhow::Result<()> {
    let cli = cli::Cli::parse();
    platform::init_logging(cli.verbose);
    let settings = Settings::load(&cli)?;

    if let Some(cli::Command::CheckUpdates) = cli.command {
        let msg = bundle::check_updates(&settings)?;
        println!("{msg}");
        return Ok(());
    }

    // Must be decided before GTK/WebKit initialize.
    if platform::should_disable_dmabuf(&settings) {
        log::info!("disabling WebKit DMA-BUF renderer");
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
    if settings.inhibit {
        log::warn!(
            "--inhibit requested but not yet implemented; \
             note it would pause hypridle lock/DPMS timers"
        );
    }

    let app = gtk::Application::new(
        Some("com.idlescreens.wayland"),
        gtk::gio::ApplicationFlags::NON_UNIQUE,
    );

    app.connect_activate(move |app| {
        let state = state::AppState::new(app, settings.clone());
        state::register_state(&state);

        // Bundled mode needs a resolved web root; channel mode needs it only
        // for fallback, so resolve it up front either way.
        let root = bundle::resolve_web_root(&state.settings);
        if matches!(state.settings.mode, Mode::Savers) && !root.join("index.html").is_file() {
            log::error!(
                "no web bundle at {} — install the package or pass --web-root/--channel",
                root.display()
            );
        }
        *state.web_root.borrow_mut() = Some(root);

        // Black window background even before the webview paints.
        let css = gtk::CssProvider::new();
        css.load_from_string("window.saver { background-color: black; }");
        if let Some(display) = gtk::gdk::Display::default() {
            gtk::style_context_add_provider_for_display(
                &display,
                &css,
                gtk::STYLE_PROVIDER_PRIORITY_APPLICATION,
            );
        }

        windows::create_all(&state);
        // Windowed dev / kiosk: no exit-on-input watcher. Normal overlay dismisses
        // on the first input after the session is armed (~1 s still).
        if state.settings.windowed {
            log::info!("windowed dev mode: idle input watcher disabled (close via window manager or Ctrl+C)");
        } else if state.settings.kiosk {
            log::info!("kiosk mode: idle input watcher disabled (exit via pkill/SIGTERM or hyprland binding)");
        } else {
            idle::spawn_watcher();
        }

        // hypridle convention: on-resume sends SIGTERM.
        for signum in [libc::SIGTERM, libc::SIGINT] {
            unix_signal_add_local(signum, || {
                state::with_state(|s| s.begin_shutdown());
                glib::ControlFlow::Continue
            });
        }

        if state.settings.update_on_launch {
            bundle::spawn_background_check(&state.settings);
        }

        log::info!(
            "showing ({} window(s), seed {}, mode {:?})",
            state.windows.borrow().len(),
            state.seed,
            state.settings.mode
        );
    });

    // Empty args: GTK must not try to parse our CLI flags.
    app.run_with_args::<&str>(&[]);
    Ok(())
}
