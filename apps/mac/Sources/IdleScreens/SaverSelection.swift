import Foundation

/// Pure saver-pool and selection helpers (unit-tested; used by SaverController).
enum SaverSelection {
  /// Catalog minus hidden, narrowed to favorites when any are available.
  static func buildPool(
    catalogIds: [String],
    hidden: Set<String>,
    favorites: Set<String>
  ) -> [String] {
    let visible = catalogIds.filter { !hidden.contains($0) }
    let favs = visible.filter { favorites.contains($0) }
    if !favs.isEmpty { return favs }
    return visible.isEmpty ? catalogIds : visible
  }

  /// Pinned saver index when present; otherwise `randomIndex` for cycling.
  static func startIndex(
    pool: [String],
    pinnedSaver: String?,
    randomIndex: Int = 0
  ) -> Int {
    if let pinned = pinnedSaver, let i = pool.firstIndex(of: pinned) {
      return i
    }
    guard !pool.isEmpty else { return 0 }
    return randomIndex % pool.count
  }

  static func saverAt(pool: [String], index: Int) -> String? {
    guard !pool.isEmpty else { return nil }
    let i = ((index % pool.count) + pool.count) % pool.count
    return pool[i]
  }

  /// Per-display override when valid; otherwise the global saver id.
  static func saverId(
    forDisplay _: String,
    perDisplayOverride: String?,
    catalogIds: [String],
    globalSaverId: String?
  ) -> String? {
    if let override = perDisplayOverride, !override.isEmpty,
      catalogIds.contains(override)
    {
      return override
    }
    return globalSaverId
  }
}

/// Decode savers.json from a refreshed web bundle.
enum SaverCatalogLoader {
  private struct SaverJSON: Decodable {
    let id: String
    let label: String
  }

  static func decodeCatalog(from data: Data) -> [SaverEntry]? {
    guard let decoded = try? JSONDecoder().decode([SaverJSON].self, from: data),
      !decoded.isEmpty
    else {
      return nil
    }
    return decoded.map { SaverEntry(id: $0.id, label: $0.label) }
  }

  static func resolve(data: Data?, fallback: [SaverEntry]) -> [SaverEntry] {
    guard let data, let parsed = decodeCatalog(from: data) else { return fallback }
    return parsed
  }
}
