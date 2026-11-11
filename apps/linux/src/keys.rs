//! Keys for private channels, and handing one to the channel page.
//!
//! A private channel answers its socket with `auth-required` and the page
//! answers from `localStorage["isk:<channel>"]` (idle-server
//! `site/src/lib/tokens.ts`). A channel view uses an ephemeral network
//! session (webview.rs), so its page storage starts empty on every run and
//! the key is never written to WebKit's on-disk storage; a script that runs
//! before any page script puts the key there. The key never
//! goes in the channel URL: URLs land in logs and history.
//!
//! Where keys live: one file per channel, `<config>/keys/<channel-id>`,
//! holding the token and nothing else. A file other users can read is
//! refused with a warning (`chmod 600` fixes it), the same rule ssh applies
//! to a private key. A config file is the wrong home: it is shared, copied
//! and pasted into bug reports.
//!
//! What gets seeded is narrow: only a document on the channel URL's own
//! origin, only the channel in that document's path, and only a value of the
//! server's token shape. Std-only, so it is tested without GTK.

use std::path::{Path, PathBuf};

/// `<config>/keys`.
pub fn keys_dir(config_dir: &Path) -> PathBuf {
    config_dir.join("keys")
}

/// The server's channel id shape: 1-64 of `[A-Za-z0-9_-]`.
pub fn is_channel_id(id: &str) -> bool {
    (1..=64).contains(&id.len())
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// The server's token shape, `^isk_[A-Za-z0-9_-]+$`.
pub fn is_well_formed(token: &str) -> bool {
    token.len() > 4
        && token.starts_with("isk_")
        && token
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// A key file is one short token; anything bigger is not one.
const MAX_KEY_FILE: u64 = 4096;

/// The key stored for `channel_id`, if there is a readable, private,
/// well-formed one.
///
/// Runs on the UI thread for every channel navigation, so it never blocks:
/// only a regular file is opened (a FIFO would hang `open`), every check is
/// made on the opened handle rather than the path (what is checked is what
/// is read), and a file over `MAX_KEY_FILE` bytes is refused unread past
/// that cap.
pub fn load(dir: &Path, channel_id: &str) -> Option<String> {
    use std::io::Read;

    if !is_channel_id(channel_id) {
        return None;
    }
    let path = dir.join(channel_id);
    let before = std::fs::metadata(&path).ok()?;
    if !before.is_file() {
        log_warn(&format!(
            "key file {} is not a regular file; ignoring it",
            path.display()
        ));
        return None;
    }
    let file = std::fs::File::open(&path).ok()?;
    let meta = file.metadata().ok()?;
    if !meta.is_file() {
        return None;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        if (meta.dev(), meta.ino()) != (before.dev(), before.ino()) {
            log_warn(&format!(
                "key file {} changed while being read; ignoring it",
                path.display()
            ));
            return None;
        }
        if meta.permissions().mode() & 0o077 != 0 {
            log_warn(&format!(
                "key file {} is readable by other users; ignoring it (chmod 600 it)",
                path.display()
            ));
            return None;
        }
    }
    let mut text = String::new();
    file.take(MAX_KEY_FILE + 1).read_to_string(&mut text).ok()?;
    if text.len() as u64 > MAX_KEY_FILE {
        log_warn(&format!(
            "key file {} is too large to hold a key; ignoring it",
            path.display()
        ));
        return None;
    }
    let token = text.trim();
    if is_well_formed(token) {
        Some(token.to_string())
    } else {
        log_warn(&format!(
            "key file {} does not hold an isk_ token; ignoring it",
            path.display()
        ));
        None
    }
}

fn log_warn(message: &str) {
    #[cfg(not(test))]
    log::warn!("{message}");
    #[cfg(test)]
    let _ = message;
}

/// `scheme://host[:port]` of an http(s) URL, as `location.origin` spells it.
pub fn origin(url: &str) -> Option<String> {
    let (scheme, rest) = url.split_once("://")?;
    if scheme != "http" && scheme != "https" {
        return None;
    }
    let authority = rest.split(['/', '?', '#']).next()?;
    if authority.is_empty() || authority.contains('@') {
        return None;
    }
    let authority = authority.to_ascii_lowercase();
    // `location.origin` drops a default port.
    let authority = match (scheme, authority.rsplit_once(':')) {
        ("https", Some((host, "443"))) | ("http", Some((host, "80"))) => host.to_string(),
        _ => authority,
    };
    Some(format!("{scheme}://{authority}"))
}

/// The channel a URL shows, when it is a channel page (`/channel/<id>` or
/// `/c/<id>`) on `server_origin`.
pub fn channel_in(url: &str, server_origin: &str) -> Option<String> {
    if origin(url)? != server_origin {
        return None;
    }
    let (_, rest) = url.split_once("://")?;
    let path = rest.find('/').map(|i| &rest[i..]).unwrap_or("/");
    let path = path.split(['?', '#']).next().unwrap_or("/");
    let mut parts = path.split('/').filter(|p| !p.is_empty());
    match (parts.next(), parts.next()) {
        (Some("channel" | "c"), Some(id)) if is_channel_id(id) => Some(id.to_string()),
        _ => None,
    }
}

/// A JS string literal. Every embedded value is shape-checked already; this
/// escapes anyway, so a later caller cannot turn data into script.
fn literal(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    for c in value.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '<' => out.push_str("\\u003c"),
            c if (c as u32) < 0x20 || c == '\u{2028}' || c == '\u{2029}' => {
                out.push_str(&format!("\\u{:04x}", c as u32))
            }
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// The document-start script for a load of `url`, or None when there is
/// nothing to seed: not a channel page on the server the app was pointed at
/// (`server_origin`), or no key held for that channel.
pub fn seed_script(
    url: &str,
    server_origin: &str,
    key: impl Fn(&str) -> Option<String>,
) -> Option<String> {
    let channel = channel_in(url, server_origin)?;
    let token = key(&channel).filter(|t| is_well_formed(t))?;
    Some(format!(
        "(() => {{\n  if (location.origin !== {origin}) return;\n  const m = location.pathname.match(/^\\/(?:channel|c)\\/([A-Za-z0-9_-]{{1,64}})(?:\\/|$)/);\n  if (!m || m[1] !== {channel}) return;\n  try {{ localStorage.setItem({slot}, {token}); }} catch (_) {{}}\n}})();",
        origin = literal(server_origin),
        channel = literal(&channel),
        slot = literal(&format!("isk:{channel}")),
        token = literal(&token),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    const VIEWER: &str = "isk_view_0123456789abcdef0123456789abcdef";

    fn held(id: &str) -> Option<String> {
        (id == "wall").then(|| VIEWER.to_string())
    }

    #[test]
    fn seeds_only_a_channel_page_on_the_server() {
        let o = "https://idlescreens.com";
        let s = seed_script(
            "https://idlescreens.com/channel/wall?device=linux-1",
            o,
            held,
        )
        .unwrap();
        assert!(s.contains("\"isk:wall\""));
        assert!(s.contains(VIEWER));
        assert!(s.contains("location.origin !== \"https://idlescreens.com\""));
        assert!(seed_script("https://idlescreens.com/c/wall", o, held).is_some());
        assert!(seed_script("https://evil.example/channel/wall", o, held).is_none());
        assert!(seed_script("http://idlescreens.com/channel/wall", o, held).is_none());
        assert!(seed_script("https://idlescreens.com/channel/lobby", o, held).is_none());
        assert!(seed_script("https://idlescreens.com/remote/wall", o, held).is_none());
        assert!(seed_script("file:///web/index.html", o, held).is_none());
    }

    #[test]
    fn a_local_server_port_counts() {
        let o = origin("http://localhost:8781/channel/wall?device=x").unwrap();
        assert_eq!(o, "http://localhost:8781");
        assert!(seed_script("http://localhost:8781/channel/wall", &o, held).is_some());
        assert!(seed_script("http://localhost:8787/channel/wall", &o, held).is_none());
        assert_eq!(
            origin("https://IdleScreens.com:443/x").unwrap(),
            "https://idlescreens.com"
        );
        assert!(origin("https://user@host/x").is_none());
    }

    #[test]
    fn a_malformed_key_is_never_embedded() {
        for bad in [
            "isk_view_abc\n",
            "isk_view_\");alert(1);//",
            "not-a-key",
            "isk_",
        ] {
            assert!(
                seed_script(
                    "https://idlescreens.com/channel/wall",
                    "https://idlescreens.com",
                    |_| Some(bad.to_string())
                )
                .is_none(),
                "{bad}"
            );
        }
    }

    #[test]
    fn literals_escape_whatever_they_are_given() {
        assert_eq!(
            literal("a\"b\\c</script>"),
            "\"a\\\"b\\\\c\\u003c/script>\""
        );
        assert_eq!(literal("\n"), "\"\\u000a\"");
    }

    #[test]
    fn key_files_must_be_private_and_well_formed() {
        let dir = std::env::temp_dir().join(format!("idle-keys-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("wall"), format!("{VIEWER}\n")).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(dir.join("wall"), std::fs::Permissions::from_mode(0o644))
                .unwrap();
            assert_eq!(load(&dir, "wall"), None, "world-readable is refused");
            std::fs::set_permissions(dir.join("wall"), std::fs::Permissions::from_mode(0o600))
                .unwrap();
        }
        assert_eq!(load(&dir, "wall").as_deref(), Some(VIEWER));
        assert_eq!(load(&dir, "../wall"), None, "a path is not a channel id");
        assert_eq!(load(&dir, "nope"), None);
        std::fs::write(dir.join("junk"), "hello").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(dir.join("junk"), std::fs::Permissions::from_mode(0o600))
                .unwrap();
        }
        assert_eq!(load(&dir, "junk"), None);
        std::fs::create_dir_all(dir.join("adir")).unwrap();
        assert_eq!(load(&dir, "adir"), None, "a directory is not a key file");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            // A FIFO must be refused before it is opened: opening one blocks.
            let fifo = dir.join("pipe");
            let made = std::process::Command::new("mkfifo")
                .arg(&fifo)
                .status()
                .is_ok_and(|s| s.success());
            if made {
                std::fs::set_permissions(&fifo, std::fs::Permissions::from_mode(0o600)).unwrap();
                assert_eq!(load(&dir, "pipe"), None, "a FIFO is never opened");
            }
            // An oversized file is refused, not truncated into a "token".
            let big = format!("{VIEWER}{}", "a".repeat(MAX_KEY_FILE as usize));
            std::fs::write(dir.join("big"), big).unwrap();
            std::fs::set_permissions(dir.join("big"), std::fs::Permissions::from_mode(0o600))
                .unwrap();
            assert_eq!(load(&dir, "big"), None);
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}
