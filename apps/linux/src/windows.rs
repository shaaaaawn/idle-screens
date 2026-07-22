use std::cell::Cell;
use std::rc::Rc;

use gtk4 as gtk;
use gtk4::gdk;
use gtk4::glib;
use gtk4::prelude::*;
use gtk4_layer_shell::{Edge, KeyboardMode, Layer, LayerShell};

use crate::state::AppState;

/// Create a window for every current monitor and keep the set in sync on hotplug.
pub fn create_all(state: &Rc<AppState>) {
    let display = gdk::Display::default().expect("no display");
    let monitors = display.monitors();

    for i in 0..monitors.n_items() {
        if let Some(monitor) = monitors.item(i).and_downcast::<gdk::Monitor>() {
            create_for_monitor(state, &monitor);
        }
    }

    // Hotplug: new monitors join with the same session seed/URL; windows whose
    // monitor disappeared are closed by GTK and dropped from our list.
    let hotplug_state = state.clone();
    monitors.connect_items_changed(move |model, position, _removed, added| {
        for i in position..position + added {
            if let Some(monitor) = model.item(i).and_downcast::<gdk::Monitor>() {
                log::info!("monitor added: {:?}", monitor.connector());
                create_for_monitor(&hotplug_state, &monitor);
            }
        }
        // Prune windows AND their paired webviews together so the
        // two vecs stay in sync (they're pushed in lockstep by create_for_monitor).
        {
            let mut wins = hotplug_state.windows.borrow_mut();
            let mut views = hotplug_state.webviews.borrow_mut();
            let mut i = 0;
            while i < wins.len() {
                if wins[i].is_visible() {
                    i += 1;
                } else {
                    wins.swap_remove(i);
                    if i < views.len() {
                        views.swap_remove(i);
                    }
                }
            }
        }
    });

    if state.windows.borrow().is_empty() {
        log::warn!(
            "no window created (check --output filter: {:?})",
            state.settings.output
        );
    }
}

fn create_for_monitor(state: &Rc<AppState>, monitor: &gdk::Monitor) {
    if let Some(only) = &state.settings.output {
        let connector = monitor.connector().map(|c| c.to_string());
        if connector.as_deref() != Some(only.as_str()) {
            return;
        }
    }
    // Windowed dev mode: a single plain window is enough.
    if state.settings.windowed && !state.windows.borrow().is_empty() {
        return;
    }

    let win = gtk::ApplicationWindow::new(&state.app);
    win.add_css_class("saver");

    if state.settings.windowed {
        win.set_default_size(1280, 800);
        win.set_title(Some("idle-screens (windowed dev)"));

        // Fallback when focus isn't on the webview.
        let esc_state = state.clone();
        let key = gtk::EventControllerKey::new();
        key.connect_key_pressed(move |_, key, _, modifiers| {
            if key == gdk::Key::Escape && modifiers.is_empty() {
                esc_state.begin_shutdown();
                glib::Propagation::Stop
            } else {
                glib::Propagation::Proceed
            }
        });
        win.add_controller(key);
    } else {
        // Layer-shell setup must happen before the window is realized.
        win.init_layer_shell();
        win.set_layer(Layer::Overlay);
        win.set_namespace(Some("idle-screens"));
        for edge in [Edge::Top, Edge::Bottom, Edge::Left, Edge::Right] {
            win.set_anchor(edge, true);
        }
        // Cover panels/bars too.
        win.set_exclusive_zone(-1);
        // Never grab the keyboard: input should wake the session, not feed us.
        win.set_keyboard_mode(KeyboardMode::None);
        win.set_monitor(Some(monitor));
    }

    let view = crate::webview::build(state);
    win.set_child(Some(&view));

    // Start invisible; webview.rs fades in once the page has loaded, so the
    // worst pre-paint state is black, never a white flash.
    win.set_opacity(0.0);
    win.present();

    state.windows.borrow_mut().push(win);
    state.webviews.borrow_mut().push(view);
}

/// Animate window opacity with an ease-out cubic over `dur_ms`.
pub fn fade_to(win: &gtk::ApplicationWindow, target: f64, dur_ms: u64) {
    let from = win.opacity();
    if (from - target).abs() < 0.001 || dur_ms == 0 {
        win.set_opacity(target);
        return;
    }
    // Saturate instead of wrapping: a pathological `fade_ms` config value
    // (u64) could otherwise overflow the µs conversion.
    let dur_us = i64::try_from(dur_ms)
        .unwrap_or(i64::MAX)
        .saturating_mul(1000);
    let start = Cell::new(-1_i64);
    win.add_tick_callback(move |win, clock| {
        let now = clock.frame_time();
        if start.get() < 0 {
            start.set(now);
        }
        let raw = ((now - start.get()) as f64 / dur_us as f64).clamp(0.0, 1.0);
        let eased = 1.0 - (1.0 - raw).powi(3);
        win.set_opacity(from + (target - from) * eased);
        if raw >= 1.0 {
            glib::ControlFlow::Break
        } else {
            glib::ControlFlow::Continue
        }
    });
}
