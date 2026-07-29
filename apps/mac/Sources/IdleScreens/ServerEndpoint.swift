import Foundation

/// Where this app talks to. Production unless the `serverBaseURL` user default
/// says otherwise:
///
///     defaults write com.idlescreens.mac serverBaseURL http://localhost:8787
///
/// Every endpoint (channel page, pair minting, the pair socket, MCP casting)
/// derives from that one value, so pointing a dev build at a local
/// `wrangler dev` doesn't mean patching four hardcoded hosts. An unset,
/// empty, or unparseable value falls back to production — a typo can't
/// silently take the app offline.
enum ServerEndpoint {
  static let baseKey = "serverBaseURL"
  static let production = URL(string: "https://idlescreens.com")!

  static var base: URL { base(from: UserDefaults.standard.string(forKey: baseKey)) }

  /// Split out from `base` so the parsing rules are testable without touching
  /// the user's real defaults.
  static func base(from raw: String?) -> URL {
    var text = raw?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    while text.hasSuffix("/") { text.removeLast() }
    guard !text.isEmpty, let url = URL(string: text), url.scheme != nil, url.host != nil
    else { return production }
    return url
  }

  static var isProduction: Bool { base == production }

  /// An https/http URL on the configured host.
  static func url(_ path: String, query: [URLQueryItem] = [], base: URL = ServerEndpoint.base)
    -> URL?
  {
    components(base, path, query)?.url
  }

  /// The same host as `url`, over the matching socket scheme: `ws` for an
  /// http base, `wss` for https.
  static func socketURL(
    _ path: String, query: [URLQueryItem] = [], base: URL = ServerEndpoint.base
  ) -> URL? {
    guard var parts = components(base, path, query) else { return nil }
    parts.scheme = parts.scheme == "http" ? "ws" : "wss"
    return parts.url
  }

  private static func components(_ base: URL, _ path: String, _ query: [URLQueryItem])
    -> URLComponents?
  {
    guard var parts = URLComponents(url: base, resolvingAgainstBaseURL: false) else { return nil }
    parts.path = path
    if !query.isEmpty { parts.queryItems = query }
    return parts
  }
}
