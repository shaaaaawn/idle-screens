//! Build provenance baked into the binary: git commit (+dirty), build date,
//! and build kind ("local" dev builds vs "release" from CI, which sets
//! IDLE_BUILD_KIND=release). Surfaced by the tray About item and at startup.

use std::process::Command;

fn git(args: &[&str]) -> Option<String> {
    Command::new("git")
        .args(args)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
}

fn main() {
    let mut commit = git(&["rev-parse", "--short", "HEAD"]).unwrap_or_else(|| "unknown".into());
    if git(&["status", "--porcelain"])
        .map(|s| !s.is_empty())
        .unwrap_or(false)
    {
        commit.push_str("-dirty");
    }
    let date = Command::new("date")
        .args(["-u", "+%Y-%m-%d %H:%MZ"])
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_else(|| "unknown".into());

    println!("cargo:rustc-env=IDLE_GIT_COMMIT={commit}");
    println!("cargo:rustc-env=IDLE_BUILD_DATE={date}");
    println!(
        "cargo:rustc-env=IDLE_BUILD_KIND={}",
        std::env::var("IDLE_BUILD_KIND").unwrap_or_else(|_| "local".into())
    );
    println!("cargo:rerun-if-env-changed=IDLE_BUILD_KIND");
}
