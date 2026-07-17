import AppKit
import CryptoKit
import WebKit

/// Renders a small preview of each bundled saver in an offscreen WKWebView and
/// caches it as a PNG, so the Saver menu can show real thumbnails. Uses the
/// same engine the app already ships — no build-time browser needed. Cached
/// under Application Support keyed by app version, so a new build regenerates.
final class ThumbnailRenderer: NSObject, WKNavigationDelegate {
  static let renderSize = NSSize(width: 480, height: 270)
  static let menuSize = NSSize(width: 40, height: 22)

  private var window: NSWindow?
  private var webView: WKWebView?
  private var queue: [String] = []
  private var settleTimer: Timer?

  /// Called on the main thread as each thumbnail becomes available.
  var onThumb: ((_ id: String, _ image: NSImage) -> Void)?
  /// Called when the whole queue is done (or there was nothing to do).
  var onComplete: (() -> Void)?

  private lazy var cacheDir: URL = {
    // Key the cache on a hash of savers.json (falling back to app version) so a
    // bundle refresh or any saver-list change regenerates thumbnails.
    let key: String
    if let data = BundleManager.shared.saversJSONData() {
      let digest = SHA256.hash(data: data)
      key = digest.prefix(6).map { String(format: "%02x", $0) }.joined()
    } else {
      key = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "dev"
    }
    let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    let dir = base.appendingPathComponent("idle-screens/thumbs/\(key)", isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
  }()

  private func cacheURL(_ id: String) -> URL {
    cacheDir.appendingPathComponent("\(id).png")
  }

  /// (number of cached PNGs, total bytes) for diagnostics.
  func cacheInfo() -> (count: Int, bytes: Int) {
    let fm = FileManager.default
    guard let files = try? fm.contentsOfDirectory(at: cacheDir, includingPropertiesForKeys: [.fileSizeKey])
    else { return (0, 0) }
    let pngs = files.filter { $0.pathExtension == "png" }
    let bytes = pngs.reduce(0) {
      $0 + ((try? $1.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0)
    }
    return (pngs.count, bytes)
  }

  /// Load a cached thumbnail if present, scaled for a menu item.
  func cachedImage(for id: String) -> NSImage? {
    guard let img = NSImage(contentsOf: cacheURL(id)) else { return nil }
    img.size = Self.menuSize
    return img
  }

  /// Generate any thumbnails not already cached. No-op in channel mode.
  func generateMissing(ids: [String]) {
    queue = ids.filter { !FileManager.default.fileExists(atPath: cacheURL($0).path) }
    guard !queue.isEmpty else { onComplete?(); return }
    setupWebView()
    renderNext()
  }

  private func setupWebView() {
    let frame = NSRect(origin: .zero, size: Self.renderSize)
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .nonPersistent()
    let wv = WKWebView(frame: frame, configuration: config)
    wv.navigationDelegate = self
    wv.setValue(false, forKey: "drawsBackground")

    // Off-desktop window so macOS still renders the layer but the user never
    // sees it. Ordered front regardless (invisible position).
    let win = NSWindow(
      contentRect: NSRect(x: -30000, y: -30000, width: Self.renderSize.width,
        height: Self.renderSize.height),
      styleMask: [.borderless], backing: .buffered, defer: false)
    win.contentView = wv
    win.orderFrontRegardless()

    webView = wv
    window = win
  }

  private func renderNext() {
    guard let id = queue.first, let webView else {
      teardown()
      onComplete?()
      return
    }
    guard let webRoot = BundleManager.shared.webRoot else {
      queue.removeFirst()
      renderNext()
      return
    }
    var comps = URLComponents(
      url: webRoot.appendingPathComponent("index.html"), resolvingAgainstBaseURL: false)!
    comps.queryItems = [
      URLQueryItem(name: "saver", value: id),
      URLQueryItem(name: "seed", value: "42"),
    ]
    webView.loadFileURL(comps.url!, allowingReadAccessTo: webRoot)
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    // Let the saver populate the frame before snapshotting. Slow savers (fish
    // swim in from the edges) need a couple seconds; this is one-time + cached.
    settleTimer?.invalidate()
    settleTimer = Timer.scheduledTimer(withTimeInterval: 2.5, repeats: false) { [weak self] _ in
      self?.snapshot()
    }
  }

  private func snapshot() {
    guard let webView, let id = queue.first else { return }
    let config = WKSnapshotConfiguration()
    config.rect = webView.bounds
    webView.takeSnapshot(with: config) { [weak self] image, _ in
      guard let self else { return }
      if let image, let png = Self.pngData(image) {
        try? png.write(to: self.cacheURL(id))
        let menuImg = image
        menuImg.size = Self.menuSize
        self.onThumb?(id, menuImg)
      }
      self.queue.removeFirst()
      self.renderNext()
    }
  }

  private static func pngData(_ image: NSImage) -> Data? {
    guard let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff) else {
      return nil
    }
    return rep.representation(using: .png, properties: [:])
  }

  private func teardown() {
    settleTimer?.invalidate()
    settleTimer = nil
    window?.orderOut(nil)
    window?.contentView = nil
    window = nil
    webView = nil
  }
}
