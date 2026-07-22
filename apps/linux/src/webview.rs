use std::rc::Rc;

use gtk4::gdk;
use gtk4::gio;
use gtk4::prelude::*;
use webkit6::prelude::*;
use webkit6::{NavigationPolicyDecision, PolicyDecisionType};

use crate::config::Mode;
use crate::state::AppState;

const QUIT_URI: &str = "idle-screens://quit";

/// Build a webview showing the session URL, wired for fade-in, crash recovery,
/// and channel→bundled fallback.
pub fn build(state: &Rc<AppState>) -> webkit6::WebView {
    let view = webkit6::WebView::new();

    // Black before first paint — never a white flash.
    view.set_background_color(&gdk::RGBA::new(0.0, 0.0, 0.0, 1.0));
    if let Some(settings) = webkit6::prelude::WebViewExt::settings(&view) {
        settings.set_enable_webgl(true);
        settings.set_media_playback_requires_user_gesture(false);
        // Bundled mode loads file://; allow sibling assets under the web root.
        settings.set_allow_file_access_from_file_urls(true);
        settings.set_allow_universal_access_from_file_urls(true);
    }

    // A screensaver has no right-click menu.
    view.connect_context_menu(|_, _, _| true);

    // Windowed dev: Escape in the webview → native quit via custom URI.
    if state.settings.windowed {
        let quit_state = state.clone();
        view.connect_decide_policy(move |_, decision, decision_type| {
            if decision_type != PolicyDecisionType::NavigationAction {
                decision.use_();
                return false;
            }
            let is_quit = decision
                .downcast_ref::<NavigationPolicyDecision>()
                .and_then(|nav| nav.navigation_action())
                .and_then(|action| action.request())
                .and_then(|req| req.uri())
                .is_some_and(|uri| uri.starts_with(QUIT_URI));
            if is_quit {
                decision.ignore();
                quit_state.begin_shutdown();
            } else {
                decision.use_();
            }
            false
        });
    }

    // Web content process died → reload (Mac watchdog parity).
    let crash_state = state.clone();
    view.connect_web_process_terminated(move |view, reason| {
        log::warn!("web process terminated ({reason:?}); reloading");
        view.load_uri(&crash_state.current_url());
    });

    // Channel load failed → flip EVERY window to the bundled engine (global,
    // like the Mac channelFallback). file:// failures never trigger it.
    let fail_state = state.clone();
    view.connect_load_failed(move |_, _, failing_uri, error| {
        let is_channel = matches!(fail_state.settings.mode, Mode::Channel(_));
        if is_channel && !failing_uri.starts_with("file://") && !fail_state.channel_fell_back.get()
        {
            fail_state.channel_fell_back.set(true);
            log::warn!("channel load failed ({error}); falling back to bundled savers");
            let url = fail_state.bundled_url();
            for v in fail_state.webviews.borrow().iter() {
                v.load_uri(&url);
            }
        } else {
            log::warn!("load failed for {failing_uri}: {error}");
        }
        true
    });

    // Fade the containing window in once the page has actually rendered.
    let fade_state = state.clone();
    view.connect_load_changed(move |view, event| {
        if event == webkit6::LoadEvent::Finished {
            log::info!("loaded: {}", view.uri().unwrap_or_default());
            if let Some(win) = view
                .root()
                .and_then(|r| r.downcast::<gtk4::ApplicationWindow>().ok())
            {
                crate::windows::fade_in(&win, fade_state.settings.fade_ms, &fade_state);
            }
            // Windowed dev: focus the webview so ←/→ reach the page.
            if fade_state.settings.windowed {
                view.grab_focus();
            }
        }
    });

    view.load_uri(&state.current_url());
    view
}

/// One-way native→JS bridge (the web bundle exposes `window.__idleScreensMac`).
#[allow(dead_code)] // used by future browse/toast features
pub fn set_saver(view: &webkit6::WebView, id: &str) {
    eval(
        view,
        &format!(
            "window.__idleScreensMac && window.__idleScreensMac.setSaver({})",
            serde_json::to_string(id).expect("string serializes")
        ),
    );
}

#[allow(dead_code)]
pub fn eval(view: &webkit6::WebView, js: &str) {
    view.evaluate_javascript(js, None, None, None::<&gio::Cancellable>, |_| {});
}
