//! Web-bundle resolution and refresh — a port of the Mac app's
//! BundleManager.swift. The server bundle at `<base_url>manifest.json` is the
//! same artifact the Mac app consumes.
//!
//! Resolution order: `--web-root` override → cache (if valid) → shipped.
//! Cache validity includes an anti-downgrade rule: a cached savers.json with
//! fewer savers than the shipped one is discarded, so a stale/broken server
//! bundle can never shrink the built-in set.

use std::path::{Path, PathBuf};

use anyhow::{bail, Context};
use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::config::{data_dir, Settings};

/// Shipped bundle location; overridable at build time and at runtime for dev.
const DEFAULT_SHIPPED: &str = "/usr/share/idle-screens/web";

#[derive(Deserialize, Debug)]
struct Manifest {
    version: i64,
    files: Vec<ManifestFile>,
}

#[derive(Deserialize, Debug)]
struct ManifestFile {
    path: String,
    sha256: String,
}

pub fn shipped_root() -> PathBuf {
    if let Ok(dir) = std::env::var("IDLE_SCREENS_WEB") {
        return PathBuf::from(dir);
    }
    PathBuf::from(option_env!("IDLE_SCREENS_WEB_DIR").unwrap_or(DEFAULT_SHIPPED))
}

fn cache_root() -> PathBuf {
    data_dir().join("web-cache")
}

fn version_file() -> PathBuf {
    data_dir().join("web-cache.version")
}

fn cached_version() -> i64 {
    std::fs::read_to_string(version_file())
        .ok()
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(0)
}

/// Resolve the web root the session should load from.
pub fn resolve_web_root(settings: &Settings) -> PathBuf {
    if let Some(root) = &settings.web_root_override {
        return root.clone();
    }
    let shipped = shipped_root();
    let cache = cache_root();
    if cache_is_valid(&cache, &shipped) {
        log::info!(
            "using cached bundle v{} at {}",
            cached_version(),
            cache.display()
        );
        cache
    } else {
        shipped
    }
}

fn cache_is_valid(cache: &Path, shipped: &Path) -> bool {
    if !cache.join("index.html").is_file() || !cache.join("assets/main.js").is_file() {
        return false;
    }
    // Anti-downgrade: never accept a cache with fewer savers than shipped.
    let cached = saver_count(&cache.join("savers.json"));
    let shipped_count = saver_count(&shipped.join("savers.json"));
    match (cached, shipped_count) {
        (Some(c), Some(s)) => c >= s,
        (Some(_), None) => true, // no shipped catalog to compare against
        _ => false,
    }
}

fn saver_count(path: &Path) -> Option<usize> {
    let text = std::fs::read_to_string(path).ok()?;
    let parsed: serde_json::Value = serde_json::from_str(&text).ok()?;
    Some(parsed.as_array()?.len())
}

/// Reject absolute paths and any `..` traversal (straight Swift port).
pub fn is_safe_manifest_path(path: &str) -> bool {
    if path.is_empty() || path.starts_with('/') || path.starts_with('\\') {
        return false;
    }
    !path
        .split(['/', '\\'])
        .any(|segment| segment == ".." || segment.is_empty())
}

/// Fetch + verify + install the latest bundle. Returns a human-readable outcome.
pub fn check_updates(settings: &Settings) -> anyhow::Result<String> {
    let base = &settings.update_base_url;
    let manifest_url = format!("{base}manifest.json");
    let manifest: Manifest = serde_json::from_reader(
        ureq::get(&manifest_url)
            .timeout(std::time::Duration::from_secs(10))
            .call()
            .with_context(|| format!("fetching {manifest_url}"))?
            .into_reader(),
    )
    .context("parsing manifest.json")?;

    let current = cached_version();
    if manifest.version <= current {
        return Ok(format!(
            "up to date (server v{}, cached v{current})",
            manifest.version
        ));
    }

    // PID-scoped: the tray can spawn a `check-updates` process while a
    // separately running overlay's own launch-time check is also downloading,
    // so a shared fixed staging dir could have one process's download clobber
    // the other's.
    let staging = data_dir().join(format!("web-cache-staging-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&staging);
    std::fs::create_dir_all(&staging)?;

    let install = || -> anyhow::Result<()> {
        for file in &manifest.files {
            if !is_safe_manifest_path(&file.path) {
                bail!("unsafe manifest path: {}", file.path);
            }
            let url = format!("{base}{}", file.path);
            let mut bytes = Vec::new();
            std::io::copy(
                &mut ureq::get(&url)
                    .timeout(std::time::Duration::from_secs(30))
                    .call()
                    .with_context(|| format!("fetching {url}"))?
                    .into_reader(),
                &mut bytes,
            )?;
            let digest = hex(&Sha256::digest(&bytes));
            if digest != file.sha256.to_lowercase() {
                bail!("sha256 mismatch for {} ({digest})", file.path);
            }
            let dest = staging.join(&file.path);
            if let Some(parent) = dest.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::write(&dest, &bytes)?;
        }
        Ok(())
    };

    if let Err(e) = install() {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(e);
    }

    // Swap, then re-validate (the anti-downgrade rule applies to the fresh
    // cache too — a server bundle with fewer savers gets discarded). Back up
    // the previous cache first so a bad swap restores it instead of leaving
    // the session on `shipped` — a working newer cache shouldn't be lost to
    // a failed *later* update attempt.
    let cache = cache_root();
    let backup = data_dir().join("web-cache-backup");
    let _ = std::fs::remove_dir_all(&backup);
    let had_previous_cache = cache.exists();
    if had_previous_cache {
        std::fs::rename(&cache, &backup).context("backing up previous cache")?;
    }

    if let Err(e) = std::fs::rename(&staging, &cache).context("installing staged bundle") {
        if had_previous_cache {
            let _ = std::fs::rename(&backup, &cache);
        }
        return Err(e);
    }
    std::fs::write(version_file(), manifest.version.to_string())?;

    if !cache_is_valid(&cache, &shipped_root()) {
        let _ = std::fs::remove_dir_all(&cache);
        let _ = std::fs::remove_file(version_file());
        if had_previous_cache {
            let _ = std::fs::rename(&backup, &cache);
            std::fs::write(version_file(), current.to_string())?;
            bail!("downloaded bundle failed validation (anti-downgrade); kept previous cache v{current}");
        }
        bail!("downloaded bundle failed validation (anti-downgrade); keeping shipped");
    }

    let _ = std::fs::remove_dir_all(&backup);
    Ok(format!("updated to v{}", manifest.version))
}

/// Launch-time check: background thread, result applies next launch.
pub fn spawn_background_check(settings: &Settings) {
    let settings = settings.clone();
    std::thread::Builder::new()
        .name("bundle-check".into())
        .spawn(move || match check_updates(&settings) {
            Ok(msg) => log::info!("bundle check: {msg}"),
            Err(e) => log::warn!("bundle check failed: {e:#}"),
        })
        .ok();
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_paths() {
        assert!(is_safe_manifest_path("index.html"));
        assert!(is_safe_manifest_path("assets/main.js"));
        assert!(!is_safe_manifest_path("/etc/passwd"));
        assert!(!is_safe_manifest_path("../escape"));
        assert!(!is_safe_manifest_path("a/../b"));
        assert!(!is_safe_manifest_path("a//b"));
        assert!(!is_safe_manifest_path(""));
        assert!(!is_safe_manifest_path("\\windows"));
    }

    #[test]
    fn hex_encodes_lowercase() {
        assert_eq!(hex(&[0xde, 0xad, 0x00]), "dead00");
    }

    #[test]
    fn manifest_parses() {
        let m: Manifest = serde_json::from_str(
            r#"{"version": 3, "files": [{"path": "index.html", "sha256": "AB"}]}"#,
        )
        .unwrap();
        assert_eq!(m.version, 3);
        assert_eq!(m.files.len(), 1);
    }

    #[test]
    fn saver_count_reads_arrays() {
        let dir = std::env::temp_dir().join(format!("isw-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("savers.json");
        std::fs::write(&p, r#"[{"id":"a"},{"id":"b"}]"#).unwrap();
        assert_eq!(saver_count(&p), Some(2));
        std::fs::write(&p, "not json").unwrap();
        assert_eq!(saver_count(&p), None);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
