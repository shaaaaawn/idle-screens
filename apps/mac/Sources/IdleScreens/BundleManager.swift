import CryptoKit
import Foundation

/// Resolves which web bundle to load — a locally cached update from the site,
/// or the bundle shipped in Resources. Offline-first: the shipped bundle always
/// works; a cached update is used only when complete and newer.
///
/// The site is expected to host `<baseURL>/manifest.json`:
///   { "version": 3, "files": ["index.html", "assets/main.js", "savers.json"] }
/// Files are fetched relative to baseURL and cached verbatim. If the fetch
/// fails, the shipped bundle stays in use.
final class BundleManager {
  static let shared = BundleManager()

  private let defaults = UserDefaults.standard
  private static let versionKey = "cachedBundleVersion"
  private static let baseURLKey = "bundleUpdateBaseURL"

  /// Default update source. Requires the site to serve /mac/ (not yet deployed).
  var baseURL: URL {
    URL(string: defaults.string(forKey: Self.baseURLKey) ?? "https://idlescreens.com/mac/")!
  }

  private var cacheRoot: URL {
    let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    return base.appendingPathComponent("idle-screens/web-cache", isDirectory: true)
  }

  private var shippedRoot: URL? {
    guard let resourcePath = Bundle.main.resourcePath else { return nil }
    return URL(fileURLWithPath: resourcePath).appendingPathComponent("web")
  }

  /// True when a valid cached bundle exists and should be used. Requires the
  /// core files AND that the cached saver set is at least as large as the
  /// shipped one — so a server bundle that is behind the app (fewer savers)
  /// never silently downgrades what the user sees.
  var usingCachedBundle: Bool {
    let fm = FileManager.default
    guard fm.fileExists(atPath: cacheRoot.appendingPathComponent("index.html").path),
      fm.fileExists(atPath: cacheRoot.appendingPathComponent("assets/main.js").path)
    else { return false }
    guard let data = try? Data(contentsOf: cacheRoot.appendingPathComponent("savers.json")),
      let cached = SaverCatalogLoader.decodeCatalog(from: data),
      cached.count >= SaverCatalog.all.count
    else { return false }
    return true
  }

  /// The web root to load savers from (cached update or shipped).
  var webRoot: URL? {
    usingCachedBundle ? cacheRoot : shippedRoot
  }

  /// Discard any cached bundle and revert to the shipped one.
  func resetToShipped() {
    try? FileManager.default.removeItem(at: cacheRoot)
    defaults.removeObject(forKey: Self.versionKey)
  }

  var source: String { usingCachedBundle ? "cached update" : "shipped" }

  /// Contents of savers.json for the active bundle (used for thumbnail keying).
  func saversJSONData() -> Data? {
    guard let root = webRoot else { return nil }
    return try? Data(contentsOf: root.appendingPathComponent("savers.json"))
  }

  /// The saver list from the active bundle's savers.json, or the compiled
  /// catalog as a fallback. This is what lets a refreshed bundle add savers to
  /// the menu + cycle pool without an app update.
  func saverCatalog() -> [SaverEntry] {
    SaverCatalogLoader.resolve(data: saversJSONData(), fallback: SaverCatalog.all)
  }

  struct ManifestFile: Decodable {
    let path: String
    /// Lowercase hex SHA-256 of the file's bytes. Downloads that don't match
    /// are rejected — a compromised host/CDN can't ship the app arbitrary code.
    let sha256: String
  }

  struct Manifest: Decodable {
    let version: Int
    let files: [ManifestFile]
  }

  /// Fetch the manifest; if newer than the cached version, download all files.
  /// completion is called on the main thread with (updated, message).
  func checkForUpdates(completion: @escaping (Bool, String) -> Void) {
    let manifestURL = baseURL.appendingPathComponent("manifest.json")
    let task = URLSession.shared.dataTask(with: manifestURL) { [weak self] data, _, error in
      guard let self else { return }
      guard let data, error == nil,
        let manifest = try? JSONDecoder().decode(Manifest.self, from: data)
      else {
        DispatchQueue.main.async { completion(false, "No update available.") }
        return
      }
      let cachedVersion = self.defaults.integer(forKey: Self.versionKey)
      guard manifest.version > cachedVersion else {
        DispatchQueue.main.async { completion(false, "Already up to date.") }
        return
      }
      self.download(manifest, completion: completion)
    }
    task.resume()
  }

  private func download(_ manifest: Manifest, completion: @escaping (Bool, String) -> Void) {
    let fm = FileManager.default
    let staging = cacheRoot.deletingLastPathComponent()
      .appendingPathComponent("web-cache-staging", isDirectory: true)
    try? fm.removeItem(at: staging)
    try? fm.createDirectory(at: staging, withIntermediateDirectories: true)

    let group = DispatchGroup()
    var ok = true
    for file in manifest.files {
      group.enter()
      let src = baseURL.appendingPathComponent(file.path)
      URLSession.shared.dataTask(with: src) { data, _, _ in
        defer { group.leave() }
        guard let data else { ok = false; return }
        // Integrity gate: reject any file whose bytes don't hash to the
        // manifest's SHA-256 (defends the update path against a compromised
        // host/CDN or truncated transfer).
        let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        guard digest == file.sha256.lowercased() else {
          NSLog("[idle-screens] integrity mismatch for \(file.path): got \(digest)")
          ok = false
          return
        }
        let dest = staging.appendingPathComponent(file.path)
        try? fm.createDirectory(
          at: dest.deletingLastPathComponent(), withIntermediateDirectories: true)
        do { try data.write(to: dest) } catch { ok = false }
      }.resume()
    }

    group.notify(queue: .main) { [weak self] in
      guard let self else { return }
      guard ok else {
        try? fm.removeItem(at: staging)
        completion(false, "Update download failed.")
        return
      }
      // Atomic-ish swap: replace the cache with staging.
      try? fm.removeItem(at: self.cacheRoot)
      do {
        try fm.createDirectory(
          at: self.cacheRoot.deletingLastPathComponent(), withIntermediateDirectories: true)
        try fm.moveItem(at: staging, to: self.cacheRoot)
        self.defaults.set(manifest.version, forKey: Self.versionKey)
        if self.usingCachedBundle {
          completion(true, "Updated \(manifest.files.count) files (bundle v\(manifest.version)).")
        } else {
          // Downloaded bundle has fewer savers than the built-in set — keep the
          // built-in savers and discard the download so nothing downgrades.
          try? fm.removeItem(at: self.cacheRoot)
          completion(false, "Your built-in savers are already up to date.")
        }
      } catch {
        NSLog("[idle-screens] bundle install failed: \(error)")
        try? fm.removeItem(at: staging)
        completion(false, "Update install failed: \(error.localizedDescription)")
      }
    }
  }
}
