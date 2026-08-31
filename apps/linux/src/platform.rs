use crate::config::{DmabufPolicy, Settings};

pub fn init_logging(verbose: bool) {
    let default = if verbose { "debug" } else { "info" };
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or(default))
        .format_timestamp_millis()
        .init();
}

/// WebKitGTK's DMA-BUF renderer misbehaves on two very different stacks: NVIDIA's
/// proprietary driver (flicker/blank) and Broadcom V3D on Raspberry Pi. Returns
/// *why* we're disabling it, because on a brand-new platform "disabled" without
/// "which branch fired" is a dead end. Decide before GTK/WebKit initialize.
///
/// Either branch can be overridden from config: `[webkit] disable_dmabuf =
/// "never"` forces the renderer back on, `"always"` forces it off everywhere.
pub fn dmabuf_disable_reason(settings: &Settings) -> Option<&'static str> {
    match settings.dmabuf {
        DmabufPolicy::Always => Some("config: webkit.disable_dmabuf = \"always\""),
        DmabufPolicy::Never => None,
        DmabufPolicy::Auto => {
            if has_nvidia_proprietary() {
                Some("NVIDIA proprietary driver detected")
            } else if is_broadcom_v3d(&read_device_tree("model"), &read_device_tree("compatible")) {
                Some("Raspberry Pi / Broadcom V3D detected")
            } else {
                None
            }
        }
    }
}

fn has_nvidia_proprietary() -> bool {
    std::path::Path::new("/sys/module/nvidia").exists()
        || std::path::Path::new("/proc/driver/nvidia/version").exists()
}

/// `/proc/device-tree/compatible` is a NUL-separated list; flatten it so the
/// matcher below works on ordinary strings. Absent on x86 — yields "".
fn read_device_tree(node: &str) -> String {
    std::fs::read(format!("/proc/device-tree/{node}"))
        .map(|b| String::from_utf8_lossy(&b).replace('\0', " "))
        .unwrap_or_default()
}

/// Pure, so it unit-tests without a Pi. `compatible` is the reliable signal
/// ("raspberrypi,5-model-b brcm,bcm2712"); matching the SoC prefix `brcm,bcm2`
/// covers Pi 4 / CM4 / Pi 5. `model` is the fallback for boards that omit the
/// SoC entry. Deliberately narrow: this must not degenerate into "is aarch64".
fn is_broadcom_v3d(model: &str, compatible: &str) -> bool {
    compatible.contains("brcm,bcm2") || model.contains("Raspberry Pi")
}

#[cfg(test)]
mod tests {
    use super::*;

    // Settings has no Default; build it out the way state.rs's fixture does.
    fn settings_with(dmabuf: DmabufPolicy) -> Settings {
        Settings {
            mode: crate::config::Mode::Savers,
            saver: None,
            cycle_minutes: 10,
            brightness: 1.0,
            hints: true,
            inhibit: false,
            fade_ms: 900,
            windowed: false,
            kiosk: false,
            output: None,
            web_root_override: None,
            seed: None,
            dmabuf,
            update_on_launch: false,
            update_base_url: String::new(),
            app_id: crate::config::DEFAULT_APP_ID.to_string(),
        }
    }

    #[test]
    fn pi5_is_detected() {
        assert!(is_broadcom_v3d(
            "Raspberry Pi 5 Model B Rev 1.0",
            "raspberrypi,5-model-b brcm,bcm2712"
        ));
    }

    #[test]
    fn pi4_is_detected() {
        assert!(is_broadcom_v3d(
            "Raspberry Pi 4 Model B Rev 1.4",
            "raspberrypi,4-model-b brcm,bcm2711"
        ));
    }

    #[test]
    fn absent_device_tree_is_not_a_pi() {
        // x86: neither /proc/device-tree node exists, so both reads yield "".
        assert!(!is_broadcom_v3d("", ""));
    }

    #[test]
    fn other_arm_boards_are_not_pis() {
        assert!(!is_broadcom_v3d("Rockchip RK3588 EVB", "rockchip,rk3588"));
        assert!(!is_broadcom_v3d("NVIDIA Jetson Orin", "nvidia,p3737-0000"));
    }

    #[test]
    fn explicit_policies_skip_probing() {
        assert!(dmabuf_disable_reason(&settings_with(DmabufPolicy::Always)).is_some());
        assert!(dmabuf_disable_reason(&settings_with(DmabufPolicy::Never)).is_none());
    }
}
