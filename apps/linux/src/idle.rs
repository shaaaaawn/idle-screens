//! Exit-on-input via ext-idle-notify.
//!
//! Runs on its own thread with its own Wayland connection — zero interaction
//! with GTK's Wayland state. We create an idle notification with a ~1s timeout:
//! `Idled` fires once the user is still (immediately when launched by hypridle
//! at real idle; only after the hand leaves the mouse when launched manually),
//! which ARMS the watcher. The next `Resumed` (any input) triggers shutdown.
//! This arm-after-idle sequencing is what makes manual launches safe.

use wayland_client::protocol::{wl_registry, wl_seat};
use wayland_client::{delegate_noop, Connection, Dispatch, QueueHandle};
use wayland_protocols::ext::idle_notify::v1::client::{
    ext_idle_notification_v1::{self, ExtIdleNotificationV1},
    ext_idle_notifier_v1::ExtIdleNotifierV1,
};

const ARM_TIMEOUT_MS: u32 = 1000;

struct Watch {
    notifier: Option<(ExtIdleNotifierV1, u32)>,
    seat: Option<wl_seat::WlSeat>,
    armed: bool,
}

impl Dispatch<wl_registry::WlRegistry, ()> for Watch {
    fn event(
        state: &mut Self,
        registry: &wl_registry::WlRegistry,
        event: wl_registry::Event,
        _: &(),
        _: &Connection,
        qh: &QueueHandle<Self>,
    ) {
        if let wl_registry::Event::Global {
            name,
            interface,
            version,
        } = event
        {
            match interface.as_str() {
                "ext_idle_notifier_v1" => {
                    let bound = version.min(2);
                    state.notifier = Some((registry.bind(name, bound, qh, ()), bound));
                }
                "wl_seat" if state.seat.is_none() => {
                    state.seat = Some(registry.bind(name, 1, qh, ()));
                }
                _ => {}
            }
        }
    }
}

impl Dispatch<ExtIdleNotificationV1, ()> for Watch {
    fn event(
        state: &mut Self,
        _: &ExtIdleNotificationV1,
        event: ext_idle_notification_v1::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        match event {
            ext_idle_notification_v1::Event::Idled => {
                log::debug!("idle watcher armed");
                state.armed = true;
            }
            ext_idle_notification_v1::Event::Resumed if state.armed => {
                log::info!("input detected; exiting");
                crate::state::invoke_on_main(|s| s.begin_shutdown());
            }
            _ => {}
        }
    }
}

delegate_noop!(Watch: ignore wl_seat::WlSeat);
delegate_noop!(Watch: ExtIdleNotifierV1);

pub fn spawn_watcher() {
    std::thread::Builder::new()
        .name("idle-watch".into())
        .spawn(|| {
            if let Err(e) = run() {
                // Without the watcher we still exit via SIGTERM (hypridle
                // on-resume) — degraded but not broken.
                log::error!("idle watcher failed: {e}");
            }
        })
        .expect("spawn idle watcher");
}

fn run() -> anyhow::Result<()> {
    let conn = Connection::connect_to_env()?;
    let mut queue = conn.new_event_queue();
    let qh = queue.handle();
    conn.display().get_registry(&qh, ());

    let mut watch = Watch {
        notifier: None,
        seat: None,
        armed: false,
    };
    queue.roundtrip(&mut watch)?;

    let (notifier, version) = watch
        .notifier
        .clone()
        .ok_or_else(|| anyhow::anyhow!("compositor lacks ext-idle-notify-v1"))?;
    let seat = watch
        .seat
        .clone()
        .ok_or_else(|| anyhow::anyhow!("no wl_seat advertised"))?;

    // v2's input-idle notification ignores idle inhibitors (e.g. a video
    // playing elsewhere can't stop the saver from dismissing on input).
    let _notification = if version >= 2 {
        notifier.get_input_idle_notification(ARM_TIMEOUT_MS, &seat, &qh, ())
    } else {
        notifier.get_idle_notification(ARM_TIMEOUT_MS, &seat, &qh, ())
    };
    log::debug!("idle watcher running (ext-idle-notify v{version})");

    loop {
        queue.blocking_dispatch(&mut watch)?;
    }
}
