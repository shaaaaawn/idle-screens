import Foundation

/// Handing the channel page the key this Mac holds for it, so a private
/// channel plays instead of showing the page's private gate.
///
/// The page answers the server's `auth-required` from `localStorage`
/// (`isk:<channelId>`, idle-server `site/src/lib/tokens.ts`). This Mac's web
/// view uses a non-persistent store, so that storage starts empty on every
/// load; a script that runs before any page script puts the key there. The
/// key never goes in a URL: URLs land in logs and history, which is the rule
/// idle-server's threat model and the iOS host both keep.
///
/// What it seeds, and where, is deliberately narrow:
/// - only a document on the configured server's origin (scheme, host, port),
///   checked again inside the page against `location`, so a navigation that
///   ends somewhere else gets nothing;
/// - only the channel in that document's own path (`/channel/<id>` or
///   `/c/<id>`), never the rest of the keyring;
/// - only a value of the server's token shape, embedded as a JSON literal.
enum ChannelKeySeed {
  /// The channel a page URL shows, when it is a channel page on `server`.
  static func channelId(in url: URL, server: URL) -> String? {
    guard url.scheme == server.scheme, url.host == server.host, url.port == server.port else {
      return nil
    }
    let parts = url.path.split(separator: "/", omittingEmptySubsequences: true)
    guard parts.count >= 2, parts[0] == "channel" || parts[0] == "c" else { return nil }
    let id = String(parts[1])
    let allowed = id.unicodeScalars.allSatisfy {
      $0.isASCII && (CharacterSet.alphanumerics.contains($0) || $0 == "-" || $0 == "_")
    }
    return allowed && (1...64).contains(id.count) ? id : nil
  }

  /// The server's own shape for a channel token (`^isk_[A-Za-z0-9_-]+$`),
  /// checked per character (a regex `$` would also pass a trailing newline).
  static func isWellFormed(_ token: String) -> Bool {
    guard token.hasPrefix("isk_"), token.count > 4 else { return false }
    return token.unicodeScalars.allSatisfy {
      $0.isASCII && (CharacterSet.alphanumerics.contains($0) || $0 == "_" || $0 == "-")
    }
  }

  /// The document-start script for a load of `url`, or nil when there is
  /// nothing to seed (not a channel page on `server`, or no key held).
  static func script(for url: URL, server: URL, key: (String) -> String?) -> String? {
    guard let channelId = channelId(in: url, server: server),
      let token = key(channelId), isWellFormed(token),
      let origin = origin(of: server)
    else { return nil }
    return """
      (() => {
        if (location.origin !== \(literal(origin))) return;
        const m = location.pathname.match(/^\\/(?:channel|c)\\/([A-Za-z0-9_-]{1,64})(?:\\/|$)/);
        if (!m || m[1] !== \(literal(channelId))) return;
        try { localStorage.setItem(\(literal("isk:" + channelId)), \(literal(token))); } catch (_) {}
      })();
      """
  }

  /// `scheme://host[:port]`, as `location.origin` spells it.
  static func origin(of server: URL) -> String? {
    guard let scheme = server.scheme, let host = server.host else { return nil }
    return server.port.map { "\(scheme)://\(host):\($0)" } ?? "\(scheme)://\(host)"
  }

  /// A JSON string literal: values are embedded, never spliced into script.
  static func literal(_ value: String) -> String {
    let data = (try? JSONSerialization.data(withJSONObject: [value])) ?? Data("[\"\"]".utf8)
    return String(String(decoding: data, as: UTF8.self).dropFirst().dropLast())
  }
}
