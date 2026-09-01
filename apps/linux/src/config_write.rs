//! Writing single keys back to `config.toml` from the tray.
//!
//! Uses `toml_edit` rather than re-serializing the parsed `FileConfig`: the
//! shipped config is mostly comments explaining each key, and a round-trip
//! through `toml::to_string` would delete every one of them. Writes are
//! atomic (temp file + rename) so an interrupted write cannot leave the user
//! with a truncated config and no screensaver.

use std::path::Path;

use anyhow::{Context, Result};
use toml_edit::{value, DocumentMut};

/// A value to store, or `Unset` to remove the key so the built-in default
/// applies again.
pub enum Setting {
    Str(String),
    Int(i64),
    Float(f64),
    Bool(bool),
    Unset,
}

/// Set (or remove) one top-level key, preserving comments and formatting.
pub fn set(path: &Path, key: &str, setting: Setting) -> Result<()> {
    let text = match std::fs::read_to_string(path) {
        Ok(t) => t,
        // No config yet is normal -- the installer only seeds one when absent.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(e).with_context(|| format!("reading {}", path.display())),
    };
    let mut doc: DocumentMut = text
        .parse()
        .with_context(|| format!("parsing {}", path.display()))?;

    match setting {
        Setting::Str(v) => doc[key] = value(v),
        Setting::Int(v) => doc[key] = value(v),
        Setting::Float(v) => doc[key] = value(v),
        Setting::Bool(v) => doc[key] = value(v),
        Setting::Unset => {
            doc.remove(key);
        }
    }

    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).with_context(|| format!("creating {}", dir.display()))?;
    }
    // Same directory, so the rename is atomic rather than a cross-device copy.
    let tmp = path.with_extension("toml.tmp");
    std::fs::write(&tmp, doc.to_string()).with_context(|| format!("writing {}", tmp.display()))?;
    std::fs::rename(&tmp, path).with_context(|| format!("replacing {}", path.display()))?;
    log::info!("config: set {key} in {}", path.display());
    Ok(())
}

/// Read one top-level string key straight from the file.
///
/// `Settings` deliberately collapses mode + channel into `Mode`, so a config
/// that names a channel while running in savers mode has no way to surface
/// that name -- which the tray needs to label its mode switch.
pub fn get_str(path: &Path, key: &str) -> Option<String> {
    let text = std::fs::read_to_string(path).ok()?;
    let doc: DocumentMut = text.parse().ok()?;
    Some(doc.get(key)?.as_str()?.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpfile(name: &str) -> std::path::PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!(
            "idle-screens-cfgtest-{}-{name}.toml",
            std::process::id()
        ));
        p
    }

    /// The whole reason for toml_edit: the shipped config is mostly comments.
    #[test]
    fn preserves_comments_and_other_keys() {
        let p = tmpfile("comments");
        std::fs::write(
            &p,
            "# leading note\nmode = \"channel\"\n# about channel\nchannel = \"fishtank\"\n",
        )
        .unwrap();
        set(&p, "mode", Setting::Str("savers".into())).unwrap();
        let out = std::fs::read_to_string(&p).unwrap();
        assert!(out.contains("# leading note"), "lost comment: {out}");
        assert!(out.contains("# about channel"), "lost comment: {out}");
        assert!(out.contains("channel = \"fishtank\""), "lost key: {out}");
        assert!(out.contains("mode = \"savers\""), "did not set: {out}");
        std::fs::remove_file(&p).ok();
    }

    #[test]
    fn unset_removes_the_key() {
        let p = tmpfile("unset");
        std::fs::write(&p, "saver = \"warp\"\nhints = true\n").unwrap();
        set(&p, "saver", Setting::Unset).unwrap();
        let out = std::fs::read_to_string(&p).unwrap();
        assert!(!out.contains("saver"), "still present: {out}");
        assert!(out.contains("hints = true"), "clobbered sibling: {out}");
        std::fs::remove_file(&p).ok();
    }

    #[test]
    fn writes_a_missing_file() {
        let p = tmpfile("missing");
        std::fs::remove_file(&p).ok();
        set(&p, "brightness", Setting::Float(0.5)).unwrap();
        assert!(std::fs::read_to_string(&p)
            .unwrap()
            .contains("brightness = 0.5"));
        std::fs::remove_file(&p).ok();
    }

    #[test]
    fn leaves_no_temp_file_behind() {
        let p = tmpfile("notmp");
        set(&p, "hints", Setting::Bool(false)).unwrap();
        assert!(!p.with_extension("toml.tmp").exists());
        std::fs::remove_file(&p).ok();
    }
}
