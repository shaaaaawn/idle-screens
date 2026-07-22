use crate::config::{DmabufPolicy, Settings};

pub fn init_logging(verbose: bool) {
    let default = if verbose { "debug" } else { "info" };
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or(default))
        .format_timestamp_millis()
        .init();
}

/// WebKitGTK's DMA-BUF renderer has known flicker/blank issues on the NVIDIA
/// proprietary driver. Decide before GTK/WebKit initialize.
pub fn should_disable_dmabuf(settings: &Settings) -> bool {
    match settings.dmabuf {
        DmabufPolicy::Always => true,
        DmabufPolicy::Never => false,
        DmabufPolicy::Auto => has_nvidia_proprietary(),
    }
}

fn has_nvidia_proprietary() -> bool {
    std::path::Path::new("/sys/module/nvidia").exists()
        || std::path::Path::new("/proc/driver/nvidia/version").exists()
}
