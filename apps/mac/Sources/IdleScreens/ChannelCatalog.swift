import Foundation

/// The channels the menu can offer without the user typing an id.
///
/// Fetched from `/api/channels` and cached in defaults so the menu is populated
/// the instant it opens — a stale list beats an empty one, and a refresh lands
/// in the background. The cache records which server it came from: switching
/// `serverBaseURL` (prod ↔ a local wrangler) must not leave the other origin's
/// channel ids on screen.
enum ChannelCatalog {
  struct Entry: Codable, Equatable {
    let id: String
    let label: String?
    let tags: [String]?

    var displayLabel: String { (label?.isEmpty == false ? label! : id) }
    var isFeatured: Bool { tags?.contains("featured") == true }
  }

  /// The menu shows a short list, not all 40+ channels: whatever this Mac
  /// played recently, then featured ones to fill. Everything else is one click
  /// away behind "All Channels…", which is why the menu list can be short
  /// without hiding anything.
  static func menuList(recent: [String], limit: Int = 8) -> [Entry] {
    menuList(all: cached, recent: recent, limit: limit)
  }

  static func menuList(all: [Entry], recent: [String], limit: Int = 8) -> [Entry] {
    var picked: [Entry] = []
    for id in recent {
      guard let entry = all.first(where: { $0.id == id }) else { continue }
      picked.append(entry)
    }
    for entry in all where entry.isFeatured && !picked.contains(where: { $0.id == entry.id }) {
      picked.append(entry)
    }
    // Still short (nothing played, nothing featured) — fall back to list order.
    for entry in all where !picked.contains(where: { $0.id == entry.id }) {
      if picked.count >= limit { break }
      picked.append(entry)
    }
    return Array(picked.prefix(limit))
  }

  private static let cacheKey = "channelCatalog"
  private static let cacheOriginKey = "channelCatalogOrigin"
  private static let cacheDateKey = "channelCatalogFetchedAt"
  private static let defaults = UserDefaults.standard

  /// Cached channels for the *current* server. Empty until the first fetch.
  static var cached: [Entry] {
    guard defaults.string(forKey: cacheOriginKey) == ServerEndpoint.base.absoluteString,
      let data = defaults.data(forKey: cacheKey),
      let entries = try? JSONDecoder().decode([Entry].self, from: data)
    else { return [] }
    return entries
  }

  /// True when the cache is missing, from another server, or older than 5 min.
  static var isStale: Bool {
    guard defaults.string(forKey: cacheOriginKey) == ServerEndpoint.base.absoluteString,
      defaults.data(forKey: cacheKey) != nil
    else { return true }
    let fetched = defaults.double(forKey: cacheDateKey)
    return Date().timeIntervalSince1970 - fetched > 300
  }

  /// Refresh in the background. `completion` runs on main *only when the list
  /// changed*, so the caller can rebuild the menu without churning it on every
  /// open. Failures are silent: the menu keeps whatever it had.
  static func refresh(completion: @escaping () -> Void) {
    guard let url = ServerEndpoint.url("/api/channels") else { return }
    let origin = ServerEndpoint.base.absoluteString
    URLSession.shared.dataTask(with: url) { data, response, _ in
      guard let data,
        let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode),
        let entries = try? JSONDecoder().decode([Entry].self, from: data)
      else { return }
      DispatchQueue.main.async {
        // The base URL can change mid-flight; don't cache a reply from the
        // server we just navigated away from.
        guard origin == ServerEndpoint.base.absoluteString else { return }
        let changed = entries != cached
        defaults.set(try? JSONEncoder().encode(entries), forKey: cacheKey)
        defaults.set(origin, forKey: cacheOriginKey)
        defaults.set(Date().timeIntervalSince1970, forKey: cacheDateKey)
        if changed { completion() }
      }
    }.resume()
  }
}
