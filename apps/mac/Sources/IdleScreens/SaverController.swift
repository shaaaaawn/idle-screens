import AppKit
import IOKit.pwr_mgt
import WebKit

/// Owns the fullscreen overlay: one borderless window per screen at
/// .screenSaver level, each hosting a WKWebView with the bundled engine (or a
/// remote channel). Fades in/out, coordinates the same saver+seed across every
/// display, dismisses on any local input, holds a display-sleep assertion while
/// visible, and tears down on lock/sleep notifications.
final class SaverController: NSObject, WKNavigationDelegate {
  private var windows: [NSWindow] = []
  private var webViews: [WKWebView] = []
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

  var onDismiss: (() -> Void)?

  // Per-session coordination state.
  private var sessionSeed: UInt32 = 0
  private var currentIndex = 0

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
    currentIndex = startIndex()
    NSLog("[idle-screens] saver show: \(NSScreen.screens.count) screen(s), saver=\(currentSaverId ?? "channel")")

    buildWindows()
    NSApp.activate(ignoringOtherApps: true)
    NSApp.presentationOptions = [.hideDock, .hideMenuBar]

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
    webViews.removeAll()
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
    webViews.removeAll()
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

  private var currentSaverId: String? {
    guard channelURL == nil, !SaverCatalog.ids.isEmpty else { return nil }
    return SaverCatalog.ids[currentIndex % SaverCatalog.ids.count]
  }

  private func startIndex() -> Int {
    if let pinned = pinnedSaver, let i = SaverCatalog.ids.firstIndex(of: pinned) {
      return i
    }
    return SaverCatalog.ids.isEmpty ? 0 : Int.random(in: 0..<SaverCatalog.ids.count)
  }

  private func startCycle() {
    stopCycle()
    // Only cycle for the bundled engine, when not pinned, with a positive period.
    guard channelURL == nil, pinnedSaver == nil, cycleSeconds > 0,
      SaverCatalog.ids.count > 1
    else { return }
    let t = Timer(timeInterval: cycleSeconds, repeats: true) { [weak self] _ in
      guard let self else { return }
      self.currentIndex = (self.currentIndex + 1) % SaverCatalog.ids.count
      guard let id = self.currentSaverId else { return }
      let js = "window.__idleScreensMac && window.__idleScreensMac.setSaver(\(jsString(id)))"
      for webView in self.webViews {
        webView.evaluateJavaScript(js, completionHandler: nil)
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

    let webView = makeWebView(frame: NSRect(origin: .zero, size: screen.frame.size))
    webViews.append(webView)
    window.contentView = webView
    return window
  }

  private func makeWebView(frame: NSRect) -> WKWebView {
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
      loadBundled(into: webView)
    }
    return webView
  }

  private func loadBundled(into webView: WKWebView) {
    // resourcePath is an absolute path string even when the executable is run
    // directly; resourceURL can come back relative in that case, and a relative
    // URL through URLComponents loses its file scheme (loadFileURL then throws).
    guard let resourcePath = Bundle.main.resourcePath else { return }
    let webRoot = URL(fileURLWithPath: resourcePath).appendingPathComponent("web")
    var components = URLComponents(
      url: webRoot.appendingPathComponent("index.html"), resolvingAgainstBaseURL: false)!
    var query = [URLQueryItem(name: "seed", value: String(sessionSeed))]
    if let id = currentSaverId {
      query.append(URLQueryItem(name: "saver", value: id))
    }
    components.queryItems = query
    webView.loadFileURL(components.url!, allowingReadAccessTo: webRoot)
  }

  // Channel load failed → fall back to the bundled engine so the user never
  // sees a blank screen when offline.
  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    channelFallback(webView, error)
  }
  func webView(
    _ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
    withError error: Error
  ) {
    channelFallback(webView, error)
  }
  private func channelFallback(_ webView: WKWebView, _ error: Error) {
    guard channelURL != nil, webView.url?.isFileURL != true else { return }
    NSLog("[idle-screens] channel load failed (\(error.localizedDescription)); using bundled")
    if currentSaverId == nil { currentIndex = startIndex() }
    loadBundled(into: webView)
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
    // Ignore input for the first moment so the mouse jiggle that didn't quite
    // reset the idle timer doesn't instantly dismiss us.
    let armed = Date().addingTimeInterval(0.5)

    eventMonitor = NSEvent.addLocalMonitorForEvents(
      matching: [.mouseMoved, .keyDown, .leftMouseDown, .rightMouseDown, .scrollWheel, .otherMouseDown]
    ) { [weak self] event in
      guard let self, Date() > armed else { return event }
      self.dismiss()
      return nil  // swallow the wake event within our own app
    }

    // Belt and suspenders: WKWebView can consume events before the local
    // monitor in some first-responder configurations, and system-level idle
    // reset (e.g. input on another display's app) should also wake us.
    fastPollTimer = Timer(timeInterval: 0.25, repeats: true) { [weak self] _ in
      guard let self, self.isShowing else { return }
      if Date() > armed && IdleMonitor.secondsIdle < 0.2 {
        self.dismiss()
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
