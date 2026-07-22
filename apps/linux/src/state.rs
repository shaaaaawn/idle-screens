use std::cell::{Cell, RefCell};
use std::path::PathBuf;
use std::rc::Rc;

use gtk4 as gtk;
use gtk4::glib;
use gtk4::prelude::*;

use crate::config::{Mode, Settings};

/// Session-wide state. Lives on the GTK main thread only; other threads reach it
/// through `invoke_on_main` + the thread-local registry below.
pub struct AppState {
    pub settings: Settings,
    /// One seed per session, shared by every monitor so displays render in lockstep.
    pub seed: u32,
    pub web_root: RefCell<Option<PathBuf>>,
    /// Set once when a channel load fails; flips every window to the bundled URL.
    pub channel_fell_back: Cell<bool>,
    pub shutting_down: Cell<bool>,
    pub app: gtk::Application,
    pub windows: RefCell<Vec<gtk::ApplicationWindow>>,
    pub webviews: RefCell<Vec<webkit6::WebView>>,
}

impl AppState {
    pub fn new(app: &gtk::Application, settings: Settings) -> Rc<Self> {
        let seed = settings.seed.unwrap_or_else(fastrand::u32);
        Rc::new(AppState {
            settings,
            seed,
            web_root: RefCell::new(None),
            channel_fell_back: Cell::new(false),
            shutting_down: Cell::new(false),
            app: app.clone(),
            windows: RefCell::new(Vec::new()),
            webviews: RefCell::new(Vec::new()),
        })
    }

    /// The URL every window should currently show.
    pub fn current_url(&self) -> String {
        match &self.settings.mode {
            Mode::Channel(url) if !self.channel_fell_back.get() => url.clone(),
            _ => self.bundled_url(),
        }
    }

    /// file:// URL for the bundled engine, mirroring the Mac app's query contract.
    pub fn bundled_url(&self) -> String {
        let root = self
            .web_root
            .borrow()
            .clone()
            .unwrap_or_else(|| PathBuf::from("."));
        bundled_url_for(&root, self.seed, &self.settings)
    }

    /// Begin the fade-out → quit sequence. Idempotent (input + SIGTERM can race).
    pub fn begin_shutdown(self: &Rc<Self>) {
        if self.shutting_down.replace(true) {
            return;
        }
        log::info!("shutting down");
        let out_ms = (self.settings.fade_ms / 2).max(150);
        for win in self.windows.borrow().iter() {
            crate::windows::fade_to(win, 0.0, out_ms);
        }
        // Quit after the fade; hard watchdog in case frame callbacks stall
        // (this can run underneath hyprlock — a stuck saver there is the worst case).
        let app = self.app.clone();
        glib::timeout_add_local_once(std::time::Duration::from_millis(out_ms + 100), move || {
            app.quit();
        });
        let app = self.app.clone();
        glib::timeout_add_local_once(std::time::Duration::from_millis(1000), move || {
            app.quit();
        });
    }
}

pub fn bundled_url_for(root: &std::path::Path, seed: u32, settings: &Settings) -> String {
    let mut url = format!("file://{}/index.html?seed={}", root.display(), seed);
    if let Some(saver) = &settings.saver {
        url.push_str(&format!("&saver={saver}"));
    }
    if settings.cycle_minutes != 10 {
        url.push_str(&format!("&cycle={}", settings.cycle_minutes));
    }
    if settings.brightness < 1.0 {
        url.push_str(&format!("&brightness={:.2}", settings.brightness));
    }
    if !settings.hints {
        url.push_str("&hints=0");
    }
    url
}

// ---- cross-thread dispatch -------------------------------------------------
//
// The idle watcher lives on its own thread; `glib::idle_add_once` needs a Send
// closure, but AppState is main-thread-only. The closure runs on the main
// thread, so it can recover the state from this thread-local registry.

thread_local! {
    static STATE: RefCell<Option<Rc<AppState>>> = const { RefCell::new(None) };
}

pub fn register_state(state: &Rc<AppState>) {
    STATE.with(|s| *s.borrow_mut() = Some(state.clone()));
}

pub fn with_state(f: impl FnOnce(&Rc<AppState>)) {
    STATE.with(|s| {
        if let Some(state) = s.borrow().as_ref() {
            f(state);
        }
    });
}

/// Callable from any thread; `f` runs on the GTK main thread with the state.
pub fn invoke_on_main(f: impl Fn(&Rc<AppState>) + Send + 'static) {
    glib::idle_add_once(move || with_state(|s| f(s)));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{DmabufPolicy, Mode};

    fn settings() -> Settings {
        Settings {
            mode: Mode::Savers,
            saver: None,
            cycle_minutes: 10,
            brightness: 1.0,
            hints: true,
            inhibit: false,
            fade_ms: 900,
            windowed: false,
            output: None,
            web_root_override: None,
            seed: None,
            dmabuf: DmabufPolicy::Auto,
            update_on_launch: false,
            update_base_url: String::new(),
        }
    }

    #[test]
    fn bundled_url_defaults_are_minimal() {
        let url = bundled_url_for(std::path::Path::new("/opt/web"), 42, &settings());
        assert_eq!(url, "file:///opt/web/index.html?seed=42");
    }

    #[test]
    fn bundled_url_includes_optional_params() {
        let mut s = settings();
        s.saver = Some("warp".into());
        s.cycle_minutes = 0;
        s.brightness = 0.5;
        s.hints = false;
        let url = bundled_url_for(std::path::Path::new("/w"), 7, &s);
        assert_eq!(
            url,
            "file:///w/index.html?seed=7&saver=warp&cycle=0&brightness=0.50&hints=0"
        );
    }
}
