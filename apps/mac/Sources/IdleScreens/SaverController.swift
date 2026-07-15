import AppKit
import IOKit.pwr_mgt
import WebKit

/// Owns the fullscreen overlay: one borderless window per screen at
/// .screenSaver level, each hosting a WKWebView with the bundled engine (or a
/// remote channel). Fades in/out, coordinates the same saver+seed across every
/// display, dismisses on any local input, holds a display-sleep assertion while
/// visible, and tears down on lock/sleep notifications.
final class SaverController: NSObject, WKNavigationDelegate {
  /// A live overlay: one per display, tracking which display it covers and
  /// whether it follows the global saver (vs a per-display assignment).
  private struct Overlay {
    let key: String
    let webView: WKWebView
    let followsGlobal: Bool
  }

  private var windows: [NSWindow] = []
  private var overlays: [Overlay] = []
  private var eventMonitor: Any?
  private var fastPollTimer: Timer?
  private var cycleTimer: Timer?
  private var assertionID: IOPMAssertionID = 0
  private var hasAssertion = false
  private(set) var isShowing = false

  /// Saver id to pin, or nil to cycle across the catalog. Set from the menu.
  var pinnedSaver: String?
  /// Seconds between saver changes when cycling (0 = never). Menu-configurable.
  var cycleSeconds: TimeInterval = 600
  /// When set, load this remote channel instead of the bundled build. Falls
  /// back to the bundled build if the channel fails to load.
  var channelURL: URL?
  /// Per-display saver overrides, keyed by display id (NSScreenNumber). A
  /// display absent here follows the global pinned/cycle saver.
  var perDisplaySaver: [String: String] = [:]
  /// Overlay brightness 0..1 for night mode (1 = full). Passed to the engine.
  var brightness: Double = 1.0
  /// Favorited saver ids. When non-empty, cycle/browse draw only from these.
  var favorites: Set<String> = []
  /// Hidden saver ids — never shown in cycle/browse.
  var hidden: Set<String> = []

  var onShow: (() -> Void)?
  var onDismiss: (() -> Void)?
  /// Overlay key actions (F / Delete / Return): persist in the host and push the
  /// updated favorites/hidden/pinned back via the config.
  var onFavorite: ((String) -> Void)?
  var onHide: ((String) -> Void)?
  var onPin: ((String) -> Void)?

  /// Saver pool for this session: catalog minus hidden, narrowed to favorites
  /// when any favorite is available. Snapshotted at show().
  private var pool: [String] = []
  /// The live saver-id catalog (from the active bundle's savers.json), injected
  /// by the host. Falls back to the compiled catalog.
  var catalogIds: [String] = SaverCatalog.ids

  /// Display id string for a screen (stable across the session).
  static func displayKey(_ screen: NSScreen) -> String {
    let num = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber
    return num?.stringValue ?? "0"
  }

  // Per-session coordination state.
  private var sessionSeed: UInt32 = 0
  private var currentIndex = 0
  private var lastBrowseAt = Date.distantPast
  /// Mouse movement only wakes once the machine has genuinely gone idle.
  private var wakeSettled = false
  /// Rolling pointer origin; movement past `wakeMoveThreshold` from it wakes.
  private var wakeOrigin = NSPoint.zero
  /// Points the pointer must move (within a poll tick) to count as a wake.
  private let wakeMoveThreshold: CGFloat = 8

  private let fadeDuration: TimeInterval = 0.9

  override init() {
    super.init()
    let workspace = NSWorkspace.shared.notificationCenter
    workspace.addObserver(
      self, selector: #selector(teardownNotification),
      name: NSWorkspace.willSleepNotification, object: nil)
    workspace.addObserver(
      self, selector: #selector(teardownNotification),
      name: NSWorkspace.screensDidSleepNotification, object: nil)
    let dist = DistributedNotificationCenter.default()
    dist.addObserver(
      self, selector: #selector(teardownNotification),
      name: NSNotification.Name("com.apple.screenIsLocked"), object: nil)
    dist.addObserver(
      self, selector: #selector(teardownNotification),
      name: NSNotification.Name("com.apple.screensaver.didstart"), object: nil)
    NotificationCenter.default.addObserver(
      self, selector: #selector(screensChanged),
      name: NSApplication.didChangeScreenParametersNotification, object: nil)
  }

  // MARK: - Show / dismiss

  func show() {
    guard !isShowing else { return }
    isShowing = true

    // One seed + one saver choice for the whole session, shared by every
    // display so a multi-monitor setup shows the same thing in sync.
    sessionSeed = UInt32.random(in: 0...UInt32.max)
    pool = buildPool()
    currentIndex = startIndex()
    NSLog("[idle-screens] saver show: \(NSScreen.screens.count) screen(s), saver=\(currentSaverId ?? "channel")")

    buildWindows()
    NSApp.activate(ignoringOtherApps: true)
    NSApp.presentationOptions = [.hideDock, .hideMenuBar]
    onShow?()

    beginDisplaySleepAssertion()
    startCycle()
    // Debug: --hold keeps the saver up despite input (screenshot/inspection).
    if !CommandLine.arguments.contains("--hold") {
      installWakeMonitors()
    }
  }

  @objc func dismiss() {
    guard isShowing else { return }
    isShowing = false
    NSLog("[idle-screens] saver dismiss")

    removeWakeMonitors()
    stopCycle()
    endDisplaySleepAssertion()
    NSApp.presentationOptions = []

    let closing = windows
    windows.removeAll()
    overlays.removeAll()
    fadeOut(closing) {
      for window in closing {
        window.orderOut(nil)
        window.contentView = nil
      }
    }
    onDismiss?()
  }

  @objc private func teardownNotification() {
    DispatchQueue.main.async { [weak self] in self?.dismiss() }
  }

  @objc private func screensChanged() {
    guard isShowing else { return }
    // Rebuild windows to match the new display topology (keep session state).
    for window in windows {
      window.orderOut(nil)
      window.contentView = nil
    }
    windows.removeAll()
    overlays.removeAll()
    buildWindows()
  }

  private func buildWindows() {
    for screen in NSScreen.screens {
      let window = makeWindow(for: screen)
      windows.append(window)
      fadeIn(window)
    }
  }

  // MARK: - Saver selection / cycling

  /// Catalog minus hidden, narrowed to favorites when any are available.
  private func buildPool() -> [String] {
    SaverSelection.buildPool(catalogIds: catalogIds, hidden: hidden, favorites: favorites)
  }

  /// The global saver id (pinned or current cycle position); nil in channel mode.
  private var currentSaverId: String? {
    guard channelURL == nil else { return nil }
    return SaverSelection.saverAt(pool: pool, index: currentIndex)
  }

  /// Resolve the saver id for a specific display: its per-display override if
  /// set, otherwise the global saver. nil in channel mode.
  private func saverId(forDisplay key: String) -> String? {
    guard channelURL == nil else { return nil }
    return SaverSelection.saverId(
      forDisplay: key,
      perDisplayOverride: perDisplaySaver[key],
      catalogIds: catalogIds,
      globalSaverId: currentSaverId
    )
  }

  private func startIndex() -> Int {
    SaverSelection.startIndex(
      pool: pool,
      pinnedSaver: pinnedSaver,
      randomIndex: pool.isEmpty ? 0 : Int.random(in: 0..<pool.count)
    )
  }

  private func startCycle() {
    stopCycle()
    // Only cycle for the bundled engine, when not pinned, with a positive period.
    guard channelURL == nil, pinnedSaver == nil, cycleSeconds > 0, pool.count > 1
    else { return }
    let t = Timer(timeInterval: cycleSeconds, repeats: true) { [weak self] _ in
      guard let self else { return }
      self.currentIndex = (self.currentIndex + 1) % self.pool.count
      guard let id = self.currentSaverId else { return }
      let js = "window.__idleScreensMac && window.__idleScreensMac.setSaver(\(jsString(id)))"
      // Only advance displays that follow the global saver; per-display
      // assignments stay put.
      for overlay in self.overlays where overlay.followsGlobal {
        overlay.webView.evaluateJavaScript(js, completionHandler: nil)
      }
    }
    RunLoop.main.add(t, forMode: .common)
    cycleTimer = t
  }

  private func stopCycle() {
    cycleTimer?.invalidate()
    cycleTimer = nil
  }

  // MARK: - Window construction

  private func makeWindow(for screen: NSScreen) -> NSWindow {
    let window = NSWindow(
      contentRect: screen.frame,
      styleMask: [.borderless],
      backing: .buffered,
      defer: false,
      screen: screen
    )
    window.level = .screenSaver
    window.isOpaque = true
    window.backgroundColor = .black
    window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
    window.acceptsMouseMovedEvents = true
    window.isReleasedWhenClosed = false

    let key = Self.displayKey(screen)
    let resolvedId = saverId(forDisplay: key)
    let follows = channelURL != nil || perDisplaySaver[key]?.isEmpty != false
      || !catalogIds.contains(perDisplaySaver[key] ?? "")
    let webView = makeWebView(frame: NSRect(origin: .zero, size: screen.frame.size), saverId: resolvedId)
    overlays.append(Overlay(key: key, webView: webView, followsGlobal: follows))
    window.contentView = webView
    return window
  }

  private func makeWebView(frame: NSRect, saverId: String?) -> WKWebView {
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .nonPersistent()
    let webView = WKWebView(frame: frame, configuration: config)
    webView.autoresizingMask = [.width, .height]
    webView.navigationDelegate = self
    webView.setValue(false, forKey: "drawsBackground")  // avoid white flash
    if #available(macOS 13.3, *) {
      webView.isInspectable = true
    }

    if let channelURL {
      webView.load(URLRequest(url: channelURL))
    } else {
      loadBundled(into: webView, saverId: saverId)
    }
    return webView
  }

  private func loadBundled(into webView: WKWebView, saverId: String?) {
    // Cached site update if present, else the shipped bundle. A file URL is
    // required (loadFileURL throws on a relative/non-file URL).
    guard let webRoot = BundleManager.shared.webRoot else { return }
    var components = URLComponents(
      url: webRoot.appendingPathComponent("index.html"), resolvingAgainstBaseURL: false)!
    var query = [URLQueryItem(name: "seed", value: String(sessionSeed))]
    if let id = saverId {
      query.append(URLQueryItem(name: "saver", value: id))
    }
    if brightness < 1.0 {
      query.append(URLQueryItem(name: "brightness", value: String(format: "%.2f", brightness)))
    }
    components.queryItems = query
    webView.loadFileURL(components.url!, allowingReadAccessTo: webRoot)
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    NSLog("[idle-screens] webview loaded: \(webView.url?.lastPathComponent ?? "?")")
  }

  // Load failed → self-heal: a failed channel load falls back to the bundled
  // engine; a failed *cached-bundle* load reverts to the shipped bundle so a
  // corrupt cache never leaves a blank screen.
  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    NSLog("[idle-screens] webview didFail: \(error.localizedDescription)")
    handleLoadFailure(webView, error)
  }
  func webView(
    _ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
    withError error: Error
  ) {
    NSLog("[idle-screens] webview didFailProvisional: \(error.localizedDescription)")
    handleLoadFailure(webView, error)
  }

  private func handleLoadFailure(_ webView: WKWebView, _ error: Error) {
    if channelURL != nil {
      channelFallback(webView, error)
      return
    }
    // A cached bundle failed to load — discard it and reload from shipped.
    if BundleManager.shared.usingCachedBundle {
      NSLog("[idle-screens] cached bundle load failed; reverting to shipped")
      BundleManager.shared.resetToShipped()
      if let overlay = overlays.first(where: { $0.webView === webView }) {
        loadBundled(into: webView, saverId: saverId(forDisplay: overlay.key))
      }
    }
  }

  /// Debug: evaluate JS on the first overlay to confirm it rendered.
  func debugProbe(_ completion: @escaping (String) -> Void) {
    guard let webView = overlays.first?.webView else {
      completion("no overlay")
      return
    }
    let js = """
      JSON.stringify({
        savers: (window.__idleScreensMac && window.__idleScreensMac.savers || []).length,
        canvas: !!document.querySelector('#host canvas'),
        hostChildren: document.getElementById('host') ? document.getElementById('host').childElementCount : -1,
        url: location.href
      })
      """
    webView.evaluateJavaScript(js) { result, error in
      if let error { completion("JS error: \(error.localizedDescription)") } else {
        completion(String(describing: result))
      }
    }
  }
  private func channelFallback(_ webView: WKWebView, _ error: Error) {
    guard channelURL != nil, webView.url?.isFileURL != true else { return }
    NSLog("[idle-screens] channel load failed (\(error.localizedDescription)); using bundled")
    // channelURL is set, so saverId(forDisplay:) returns nil — force a global
    // saver choice for the fallback.
    if pool.isEmpty { pool = buildPool() }
    currentIndex = startIndex()
    let fallbackId = pool.isEmpty ? nil : pool[currentIndex % pool.count]
    loadBundled(into: webView, saverId: fallbackId)
  }

  // Watchdog: if a WKWebView's content process crashes it goes blank. Reload
  // that overlay so the screen self-heals instead of showing black.
  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    NSLog("[idle-screens] web content process terminated; reloading overlay")
    if let channelURL {
      webView.load(URLRequest(url: channelURL))
    } else if let overlay = overlays.first(where: { $0.webView === webView }) {
      loadBundled(into: webView, saverId: saverId(forDisplay: overlay.key))
    }
  }

  /// The saver id to cast to a channel: the pinned saver, else the one currently
  /// showing, else the first in the catalog.
  var castableSaverId: String? {
    if let pinned = pinnedSaver, catalogIds.contains(pinned) { return pinned }
    if isShowing, let showing = currentSaverId { return showing }
    return catalogIds.first
  }

  // MARK: - Browse (arrow keys while showing)

  func browse(delta: Int) {
    guard channelURL == nil, isShowing, pool.count > 1 else { return }
    lastBrowseAt = Date()
    currentIndex = (currentIndex + delta + pool.count) % pool.count
    guard let id = currentSaverId else { return }
    // setSaver (not next/prev) keeps Swift the source of truth and cross-fades;
    // only follow-global overlays advance (per-display assignments stay put).
    let js = "window.__idleScreensMac && window.__idleScreensMac.setSaver(\(jsString(id)))"
    for overlay in overlays where overlay.followsGlobal {
      overlay.webView.evaluateJavaScript(js, completionHandler: nil)
    }
    startCycle()  // reset the cycle countdown after a manual browse
  }

  /// Overlay keys while showing. Returns true if the key was handled (so the
  /// saver stays up). 123/124 = ←/→, 3 = F, 51 = Delete, 36 = Return.
  private func handleOverlayKey(_ keyCode: UInt16) -> Bool {
    guard channelURL == nil, isShowing else { return false }
    switch keyCode {
    case 123, 124:
      browse(delta: keyCode == 124 ? 1 : -1)
      return true
    case 3:  // F — toggle favorite
      guard let id = currentSaverId else { return true }
      lastBrowseAt = Date()
      let nowFav = !favorites.contains(id)
      if nowFav { favorites.insert(id) } else { favorites.remove(id) }
      onFavorite?(id)
      toast(nowFav ? "★ Favorited" : "☆ Unfavorited")
      return true
    case 51:  // Delete — hide from cycle, advance
      guard let id = currentSaverId else { return true }
      lastBrowseAt = Date()
      hidden.insert(id)
      favorites.remove(id)
      onHide?(id)
      pool = buildPool()
      if currentIndex >= pool.count { currentIndex = 0 }
      toast("Hidden from cycle")
      if let next = currentSaverId {
        let js = "window.__idleScreensMac && window.__idleScreensMac.setSaver(\(jsString(next)))"
        for overlay in overlays where overlay.followsGlobal {
          overlay.webView.evaluateJavaScript(js, completionHandler: nil)
        }
      }
      return true
    case 36:  // Return — pin the one you're looking at
      guard let id = currentSaverId else { return true }
      lastBrowseAt = Date()
      pinnedSaver = id
      onPin?(id)
      stopCycle()
      toast("Pinned \(id)")
      return true
    default:
      return false
    }
  }

  private func toast(_ text: String) {
    showOverlayToast(text)
  }

  /// Show a brief toast on every overlay (no-op if not showing).
  func showOverlayToast(_ text: String) {
    let js = "window.__idleScreensMac && window.__idleScreensMac.toast(\(jsString(text)))"
    for overlay in overlays {
      overlay.webView.evaluateJavaScript(js, completionHandler: nil)
    }
  }

  // MARK: - Fade

  private func fadeIn(_ window: NSWindow) {
    window.alphaValue = 0
    window.makeKeyAndOrderFront(nil)
    NSAnimationContext.runAnimationGroup { ctx in
      ctx.duration = fadeDuration
      window.animator().alphaValue = 1
    }
  }

  private func fadeOut(_ windows: [NSWindow], completion: @escaping () -> Void) {
    guard !windows.isEmpty else { completion(); return }
    NSAnimationContext.runAnimationGroup({ ctx in
      ctx.duration = fadeDuration * 0.5
      for window in windows { window.animator().alphaValue = 0 }
    }, completionHandler: completion)
  }

  // MARK: - Wake handling (no permissions needed: local monitors only)

  private func installWakeMonitors() {
    // Wake model — deliberate input wakes, small pointer drift does not:
    //   • Keys and clicks always wake (they are unambiguous).
    //   • Mouse movement wakes only after the machine has settled (been idle a
    //     beat — so a manual "Start Screen Saver" doesn't dismiss under the hand
    //     that just clicked the menu) AND only when the pointer moves more than
    //     `wakeMoveThreshold` points within a single poll window. The poll
    //     re-baselines the origin each tick while the pointer rests, so slow
    //     drift (e.g. a 2px trackpad twitch) never accumulates into a wake,
    //     while a deliberate move crosses the threshold at once.
    // The local monitor fires before view routing, so WKWebView can't swallow
    // input ahead of us — no idle-polling backstop needed (which couldn't tell
    // drift from a real move anyway).
    wakeSettled = false
    wakeOrigin = NSEvent.mouseLocation
    let armed = Date().addingTimeInterval(0.4)

    eventMonitor = NSEvent.addLocalMonitorForEvents(
      matching: [.mouseMoved, .keyDown, .leftMouseDown, .rightMouseDown, .scrollWheel, .otherMouseDown]
    ) { [weak self] event in
      guard let self, Date() > armed else { return event }
      if event.type == .keyDown, self.handleOverlayKey(event.keyCode) {
        return nil  // handled (browse/favorite/hide/pin) — don't wake
      }
      if event.type == .mouseMoved {
        guard self.wakeSettled else { return event }
        let loc = NSEvent.mouseLocation
        let moved = hypot(loc.x - self.wakeOrigin.x, loc.y - self.wakeOrigin.y)
        if moved < self.wakeMoveThreshold { return event }  // drift, not a wake
      }
      self.dismiss()
      return nil  // swallow the wake event within our own app
    }

    // Poll only maintains settle state + re-baselines the drift origin while the
    // pointer rests. It never dismisses.
    fastPollTimer = Timer(timeInterval: 0.25, repeats: true) { [weak self] _ in
      guard let self, self.isShowing else { return }
      if IdleMonitor.secondsIdle > 0.8 { self.wakeSettled = true }
      // Re-baseline the origin between ticks so only intra-tick movement counts.
      let loc = NSEvent.mouseLocation
      if hypot(loc.x - self.wakeOrigin.x, loc.y - self.wakeOrigin.y) < self.wakeMoveThreshold {
        self.wakeOrigin = loc
      }
    }
    fastPollTimer.map { RunLoop.main.add($0, forMode: .common) }
  }

  private func removeWakeMonitors() {
    if let monitor = eventMonitor {
      NSEvent.removeMonitor(monitor)
      eventMonitor = nil
    }
    fastPollTimer?.invalidate()
    fastPollTimer = nil
  }

  // MARK: - Power

  private func beginDisplaySleepAssertion() {
    guard !hasAssertion else { return }
    let result = IOPMAssertionCreateWithName(
      kIOPMAssertionTypePreventUserIdleDisplaySleep as CFString,
      IOPMAssertionLevel(kIOPMAssertionLevelOn),
      "idle-screens saver active" as CFString,
      &assertionID
    )
    hasAssertion = result == kIOReturnSuccess
  }

  private func endDisplaySleepAssertion() {
    guard hasAssertion else { return }
    IOPMAssertionRelease(assertionID)
    hasAssertion = false
  }
}

/// JSON-encode a string for safe interpolation into a JavaScript literal.
private func jsString(_ s: String) -> String {
  let data = try? JSONSerialization.data(withJSONObject: [s], options: [])
  guard let data, let arr = String(data: data, encoding: .utf8) else { return "\"\"" }
  // arr is like ["value"]; strip the surrounding brackets to get the quoted string.
  return String(arr.dropFirst().dropLast())
}
