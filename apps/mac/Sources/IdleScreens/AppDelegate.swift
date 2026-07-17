import AppKit
import ServiceManagement

final class AppDelegate: NSObject, NSApplicationDelegate {
  private var statusItem: NSStatusItem!
  /// Process activity assertion that prevents macOS from auto-terminating /
  /// App-Napping this windowless LSUIElement app (which would drop the
  /// menu-bar status item on macOS 26+). Held for the lifetime of the app.
  private var keepAliveActivity: Any?
  private let saver = SaverController()
  private lazy var idleMonitor = IdleMonitor(thresholdSeconds: savedThreshold)
  private let hotkey = HotkeyManager()
  private let hotCorner = HotCorner()
  private let onboarding = Onboarding()
  private let thumbnails = ThumbnailRenderer()

  private let defaults = UserDefaults.standard
  private static let thresholdKey = "idleThresholdSeconds"
  private static let pinnedSaverKey = "pinnedSaver"
  private static let onlyOnPowerKey = "onlyOnPower"
  private static let channelKey = "channelId"
  private static let pauseFullscreenKey = "pauseInFullscreen"
  private static let dimAtNightKey = "dimAtNight"
  private static let activeStartKey = "activeStartHour"  // -1 = disabled
  private static let activeEndKey = "activeEndHour"
  private static let perDisplayKey = "perDisplaySaver"  // [displayId: saverId]
  private static let hotkeyEnabledKey = "hotkeyEnabled"
  private static let hotCornerKey = "hotCorner"  // ScreenCorner rawValue, "" = off
  private static let favoritesKey = "favoriteSavers"
  private static let hiddenKey = "hiddenSavers"
  private static let lastUpdateCheckKey = "lastUpdateCheck"  // epoch seconds
  private static let castChannelKey = "activeCastChannel"
  private static let pendingUpdateToastKey = "pendingUpdateToast"

  /// pauseInFullscreen defaults ON (don't cover presentations/video calls).
  private var pauseInFullscreen: Bool {
    defaults.object(forKey: Self.pauseFullscreenKey) == nil
      ? true : defaults.bool(forKey: Self.pauseFullscreenKey)
  }
  private var perDisplaySaver: [String: String] {
    defaults.dictionary(forKey: Self.perDisplayKey) as? [String: String] ?? [:]
  }

  private var savedThreshold: TimeInterval {
    let v = defaults.double(forKey: Self.thresholdKey)
    return v == 0 ? 300 : v  // default 5 minutes; -1 = never
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    // Hold a process activity assertion for the app's lifetime. The
    // .userInitiatedAllowingIdleSystemSleep mask prevents App Nap, automatic
    // termination, and sudden termination (all included in it) while still
    // letting the system idle-sleep — which this app relies on for idle
    // detection. Without this, macOS 26+ App-Naps the windowless LSUIElement
    // app and drops its menu-bar status item.
    keepAliveActivity = ProcessInfo.processInfo.beginActivity(
      options: .userInitiatedAllowingIdleSystemSleep,
      reason: "Keep menu bar status item presented")

    applyConfigToSaver()

    statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    setStatusIcon("display")
    statusItem.menu = buildMenu()

    idleMonitor.onIdle = { [weak self] in self?.idleTriggered() }
    idleMonitor.start()

    // Menu-bar icon reflects state: filled while the saver shows.
    saver.onShow = { [weak self] in
      guard let self else { return }
      self.setStatusIcon("display.fill")
      // Surface a silently-installed saver update the next time the saver shows.
      if let msg = self.defaults.string(forKey: Self.pendingUpdateToastKey) {
        self.defaults.removeObject(forKey: Self.pendingUpdateToastKey)
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.6) {
          self.saver.showOverlayToast(msg)
        }
      }
    }
    saver.onDismiss = { [weak self] in
      guard let self else { return }
      self.setStatusIcon(self.isCasting ? "antenna.radiowaves.left.and.right" : "display")
    }
    // Overlay F / Delete / Return persist here and push back to the saver.
    saver.onFavorite = { [weak self] id in self?.toggleFavorite(id) }
    saver.onHide = { [weak self] id in self?.addHidden(id) }
    saver.onPin = { [weak self] id in
      guard let self else { return }
      self.defaults.set(id, forKey: Self.pinnedSaverKey)
      self.statusItem.menu = self.buildMenu()
    }

    hotkey.onTrigger = { [weak self] in self?.startSaver() }
    hotCorner.onTrigger = { [weak self] in self?.startSaver() }
    applyTriggers()

    if Onboarding.shouldShow {
      // First run: the welcome window covers the system-saver hint, so mark the
      // warnings as shown to avoid stacking dialogs.
      onboarding.onFinish = { [weak self] in self?.statusItem.menu = self?.buildMenu() }
      onboarding.show()
      defaults.set(true, forKey: "conflictWarned")
      defaults.set(true, forKey: "displaySleepWarned")
    } else {
      warnIfSystemSaverConflicts()
      warnIfDisplaySleepsFirst()
    }

    // Generate saver thumbnails in the background; refresh the menu when done.
    thumbnails.onComplete = { [weak self] in
      guard let self else { return }
      self.statusItem.menu = self.buildMenu()
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
      self?.thumbnails.generateMissing(ids: self?.liveIds ?? SaverCatalog.ids)
    }

    maybeAutoCheckForUpdates()

    // Debug: --diagnostics prints the report to stdout and exits.
    if CommandLine.arguments.contains("--diagnostics") {
      print(Diagnostics.report(thumbnails: thumbnails))
      exit(0)
    }

    // Debug: --check-updates runs a bundle refresh against the live server.
    if CommandLine.arguments.contains("--check-updates") {
      BundleManager.shared.checkForUpdates { updated, message in
        print("updated=\(updated) — \(message)")
        print("bundle source now: \(BundleManager.shared.source)")
        print("live saver count: \(BundleManager.shared.saverCatalog().count)")
        exit(0)
      }
      return
    }

    // Debug: --probe shows the saver, waits, and reports the webview state.
    if CommandLine.arguments.contains("--probe") {
      saver.show()
      DispatchQueue.main.asyncAfter(deadline: .now() + 3.5) { [weak self] in
        self?.saver.debugProbe { result in
          print("PROBE: \(result)")
          exit(0)
        }
      }
      return
    }

    // Debug: --show triggers the saver immediately (it will dismiss on first
    // input, so this is only useful for smoke tests and screenshots).
    if CommandLine.arguments.contains("--show") {
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
        self?.saver.show()
      }
    }
  }

  func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool {
    true
  }

  /// Saver list from the active bundle (server update or shipped), so refreshed
  /// bundles add savers to the menu/cycle without an app update.
  private var liveCatalog: [SaverEntry] { BundleManager.shared.saverCatalog() }
  private var liveIds: [String] { liveCatalog.map(\.id) }

  private func applyConfigToSaver() {
    saver.pinnedSaver = defaults.string(forKey: Self.pinnedSaverKey)
    saver.catalogIds = liveIds
    saver.perDisplaySaver = perDisplaySaver
    saver.favorites = Set(defaults.stringArray(forKey: Self.favoritesKey) ?? [])
    saver.hidden = Set(defaults.stringArray(forKey: Self.hiddenKey) ?? [])
    let channelId = defaults.string(forKey: Self.channelKey)
    saver.channelURL = channelId.flatMap { id in
      id.isEmpty ? nil : URL(string: "https://idlescreens.com/channel/\(id)")
    }
  }

  /// Idle-triggered start honors all the "should we?" gates. Manual start
  /// (menu / hotkey) bypasses them — the user asked explicitly.
  private func idleTriggered() {
    if defaults.bool(forKey: Self.onlyOnPowerKey) && SystemInfo.isOnBattery { return }
    if pauseInFullscreen && SystemInfo.fullscreenAppPresent { return }
    if !withinActiveHours() { return }
    startSaver()
  }

  /// Unconditional start (menu / hotkey), still applying night dimming.
  func startSaver() {
    saver.brightness = nightBrightness()
    saver.show()
  }

  private func applyTriggers() {
    if defaults.bool(forKey: Self.hotkeyEnabledKey) {
      hotkey.register()
    } else {
      hotkey.unregister()
    }
    hotCorner.corner = ScreenCorner(rawValue: defaults.string(forKey: Self.hotCornerKey) ?? "")
    hotCorner.apply()
  }

  // MARK: - Scheduling

  private func withinActiveHours() -> Bool {
    let start = defaults.object(forKey: Self.activeStartKey) as? Int ?? -1
    let end = defaults.integer(forKey: Self.activeEndKey)
    guard start >= 0, start != end else { return true }  // -1 or unset = always
    let hour = Calendar.current.component(.hour, from: Date())
    if start < end { return hour >= start && hour < end }
    return hour >= start || hour < end  // wraps past midnight
  }

  private func nightBrightness() -> Double {
    guard defaults.bool(forKey: Self.dimAtNightKey) else { return 1.0 }
    let dark = NSApp.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
    return dark ? 0.55 : 1.0
  }

  // MARK: - Menu

  private func buildMenu() -> NSMenu {
    let menu = NSMenu()

    let startNow = NSMenuItem(
      title: "Start Screen Saver", action: #selector(startNow(_:)), keyEquivalent: "s")
    startNow.target = self
    menu.addItem(startNow)

    let cast = NSMenuItem(
      title: "Cast to Channel…", action: #selector(castToChannel(_:)), keyEquivalent: "")
    cast.target = self
    menu.addItem(cast)
    if let channel = defaults.string(forKey: Self.castChannelKey), !channel.isEmpty {
      let stop = NSMenuItem(
        title: "Stop Casting (\(channel))", action: #selector(stopCasting(_:)), keyEquivalent: "")
      stop.target = self
      menu.addItem(stop)
    }
    menu.addItem(.separator())

    menu.addItem(saverPickerItem())
    if NSScreen.screens.count > 1 {
      menu.addItem(displaysItem())
    }
    menu.addItem(startAfterItem())
    menu.addItem(activeHoursItem())
    menu.addItem(contentItem())

    menu.addItem(.separator())
    menu.addItem(
      toggleItem("Hotkey (⌃⌥⌘S)", Self.hotkeyEnabledKey, #selector(toggleHotkey(_:))))
    menu.addItem(hotCornerItem())

    menu.addItem(.separator())
    menu.addItem(toggleItem("Only on Power", Self.onlyOnPowerKey, #selector(toggleDefault(_:))))
    menu.addItem(
      toggleItem("Pause During Fullscreen", Self.pauseFullscreenKey, #selector(toggleDefault(_:)),
        defaultOn: true))
    menu.addItem(toggleItem("Dim at Night", Self.dimAtNightKey, #selector(toggleDefault(_:))))
    menu.addItem(launchAtLoginItem())

    menu.addItem(.separator())
    let update = NSMenuItem(
      title: "Check for Saver Updates", action: #selector(checkForUpdates(_:)), keyEquivalent: "")
    update.target = self
    menu.addItem(update)
    if BundleManager.shared.usingCachedBundle {
      let reset = NSMenuItem(
        title: "Reset to Built-in Savers", action: #selector(resetBundle(_:)), keyEquivalent: "")
      reset.target = self
      menu.addItem(reset)
    }
    let diag = NSMenuItem(
      title: "Diagnostics…", action: #selector(showDiagnostics(_:)), keyEquivalent: "")
    diag.target = self
    menu.addItem(diag)

    menu.addItem(.separator())
    let quit = NSMenuItem(
      title: "Quit idle-screens", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    menu.addItem(quit)

    return menu
  }

  private func saverPickerItem() -> NSMenuItem {
    let submenu = NSMenu()
    let pinned = defaults.string(forKey: Self.pinnedSaverKey)

    let cycle = NSMenuItem(title: "Cycle All", action: #selector(setSaver(_:)), keyEquivalent: "")
    cycle.target = self
    cycle.representedObject = ""  // empty = cycle
    cycle.state = (pinned == nil) ? .on : .off
    submenu.addItem(cycle)
    submenu.addItem(.separator())

    let favs = Set(defaults.stringArray(forKey: Self.favoritesKey) ?? [])
    let hid = Set(defaults.stringArray(forKey: Self.hiddenKey) ?? [])
    for entry in liveCatalog {
      var title = entry.label
      if favs.contains(entry.id) { title = "★ " + title }
      if hid.contains(entry.id) { title += " (hidden)" }
      let item = NSMenuItem(title: title, action: #selector(setSaver(_:)), keyEquivalent: "")
      item.target = self
      item.representedObject = entry.id
      item.state = (pinned == entry.id) ? .on : .off
      item.image = thumbnails.cachedImage(for: entry.id)
      submenu.addItem(item)
    }

    if !favs.isEmpty || !hid.isEmpty {
      submenu.addItem(.separator())
      let reset = NSMenuItem(
        title: "Reset Favorites & Hidden", action: #selector(resetFavorites(_:)), keyEquivalent: "")
      reset.target = self
      submenu.addItem(reset)
    }

    let item = NSMenuItem(title: "Saver", action: nil, keyEquivalent: "")
    item.submenu = submenu
    return item
  }

  private func startAfterItem() -> NSMenuItem {
    let submenu = NSMenu()
    let options: [(String, TimeInterval)] = [
      ("1 minute", 60), ("5 minutes", 300), ("10 minutes", 600),
      ("30 minutes", 1800), ("Never", -1),
    ]
    for (label, seconds) in options {
      let item = NSMenuItem(title: label, action: #selector(setThreshold(_:)), keyEquivalent: "")
      item.target = self
      item.representedObject = seconds
      item.state = savedThreshold == seconds ? .on : .off
      submenu.addItem(item)
    }
    let item = NSMenuItem(title: "Start After", action: nil, keyEquivalent: "")
    item.submenu = submenu
    return item
  }

  private func contentItem() -> NSMenuItem {
    let submenu = NSMenu()
    let channelId = defaults.string(forKey: Self.channelKey) ?? ""

    let bundled = NSMenuItem(
      title: "Bundled Savers", action: #selector(useBundled(_:)), keyEquivalent: "")
    bundled.target = self
    bundled.state = channelId.isEmpty ? .on : .off
    submenu.addItem(bundled)

    let channel = NSMenuItem(
      title: channelId.isEmpty ? "Channel…" : "Channel: \(channelId)…",
      action: #selector(setChannel(_:)), keyEquivalent: "")
    channel.target = self
    channel.state = channelId.isEmpty ? .off : .on
    submenu.addItem(channel)

    let item = NSMenuItem(title: "Content", action: nil, keyEquivalent: "")
    item.submenu = submenu
    return item
  }

  /// A checkbox menu item bound to a Bool default. The default key rides on
  /// representedObject so a single action handles all of them.
  private func toggleItem(
    _ title: String, _ key: String, _ action: Selector, defaultOn: Bool = false
  ) -> NSMenuItem {
    let item = NSMenuItem(title: title, action: action, keyEquivalent: "")
    item.target = self
    item.representedObject = key
    let value = defaults.object(forKey: key) == nil ? defaultOn : defaults.bool(forKey: key)
    item.state = value ? .on : .off
    return item
  }

  private func displaysItem() -> NSMenuItem {
    let submenu = NSMenu()
    let assignments = perDisplaySaver
    for (index, screen) in NSScreen.screens.enumerated() {
      let key = SaverController.displayKey(screen)
      let name = screen.localizedName.isEmpty ? "Display \(index + 1)" : screen.localizedName
      let dspMenu = NSMenu()

      let follow = NSMenuItem(
        title: "Follow Global", action: #selector(setDisplaySaver(_:)), keyEquivalent: "")
      follow.target = self
      follow.representedObject = ["display": key, "saver": ""]
      follow.state = (assignments[key] ?? "").isEmpty ? .on : .off
      dspMenu.addItem(follow)
      dspMenu.addItem(.separator())

      for entry in liveCatalog {
        let item = NSMenuItem(
          title: entry.label, action: #selector(setDisplaySaver(_:)), keyEquivalent: "")
        item.target = self
        item.representedObject = ["display": key, "saver": entry.id]
        item.state = (assignments[key] == entry.id) ? .on : .off
        dspMenu.addItem(item)
      }

      let dspItem = NSMenuItem(title: name, action: nil, keyEquivalent: "")
      dspItem.submenu = dspMenu
      submenu.addItem(dspItem)
    }
    let item = NSMenuItem(title: "Per Display", action: nil, keyEquivalent: "")
    item.submenu = submenu
    return item
  }

  private func hotCornerItem() -> NSMenuItem {
    let submenu = NSMenu()
    let selected = defaults.string(forKey: Self.hotCornerKey) ?? ""

    let off = NSMenuItem(title: "Off", action: #selector(setHotCorner(_:)), keyEquivalent: "")
    off.target = self
    off.representedObject = ""
    off.state = selected.isEmpty ? .on : .off
    submenu.addItem(off)
    submenu.addItem(.separator())

    for corner in ScreenCorner.allCases {
      let item = NSMenuItem(
        title: corner.label, action: #selector(setHotCorner(_:)), keyEquivalent: "")
      item.target = self
      item.representedObject = corner.rawValue
      item.state = selected == corner.rawValue ? .on : .off
      submenu.addItem(item)
    }
    let item = NSMenuItem(title: "Hot Corner", action: nil, keyEquivalent: "")
    item.submenu = submenu
    return item
  }

  private func activeHoursItem() -> NSMenuItem {
    let submenu = NSMenu()
    let start = defaults.object(forKey: Self.activeStartKey) as? Int ?? -1
    let end = defaults.integer(forKey: Self.activeEndKey)

    let presets: [(String, Int, Int)] = [
      ("Always", -1, 0), ("Daytime (9–18)", 9, 18),
      ("Work (8–20)", 8, 20), ("Evening (18–24)", 18, 24),
    ]
    for (label, s, e) in presets {
      let item = NSMenuItem(title: label, action: #selector(setActiveHours(_:)), keyEquivalent: "")
      item.target = self
      item.representedObject = [s, e]
      item.state = (start == s && (s < 0 || end == e)) ? .on : .off
      submenu.addItem(item)
    }
    let item = NSMenuItem(title: "Active Hours", action: nil, keyEquivalent: "")
    item.submenu = submenu
    return item
  }

  private func launchAtLoginItem() -> NSMenuItem {
    let item = NSMenuItem(
      title: "Launch at Login", action: #selector(toggleLaunchAtLogin(_:)), keyEquivalent: "")
    item.target = self
    item.state = SMAppService.mainApp.status == .enabled ? .on : .off
    return item
  }

  // MARK: - Actions

  @objc private func startNow(_ sender: NSMenuItem) {
    startSaver()
  }

  @objc private func setSaver(_ sender: NSMenuItem) {
    let id = sender.representedObject as? String ?? ""
    if id.isEmpty {
      defaults.removeObject(forKey: Self.pinnedSaverKey)
    } else {
      defaults.set(id, forKey: Self.pinnedSaverKey)
    }
    applyConfigToSaver()
    statusItem.menu = buildMenu()
  }

  @objc private func resetFavorites(_ sender: NSMenuItem) {
    defaults.removeObject(forKey: Self.favoritesKey)
    defaults.removeObject(forKey: Self.hiddenKey)
    applyConfigToSaver()
    statusItem.menu = buildMenu()
  }

  @objc private func setThreshold(_ sender: NSMenuItem) {
    guard let seconds = sender.representedObject as? TimeInterval else { return }
    defaults.set(seconds, forKey: Self.thresholdKey)
    idleMonitor.thresholdSeconds = seconds
    statusItem.menu = buildMenu()
  }

  @objc private func useBundled(_ sender: NSMenuItem) {
    defaults.removeObject(forKey: Self.channelKey)
    applyConfigToSaver()
    statusItem.menu = buildMenu()
  }

  @objc private func setChannel(_ sender: NSMenuItem) {
    let alert = NSAlert()
    alert.messageText = "Show an idlescreens.com channel"
    alert.informativeText =
      "Enter a channel id (e.g. default, lobby, studio). The Mac becomes a live display for that channel, steerable over MCP. Leave blank to use bundled savers."
    let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 240, height: 24))
    field.stringValue = defaults.string(forKey: Self.channelKey) ?? ""
    alert.accessoryView = field
    alert.addButton(withTitle: "Set")
    alert.addButton(withTitle: "Cancel")
    NSApp.activate(ignoringOtherApps: true)
    guard alert.runModal() == .alertFirstButtonReturn else { return }
    let id = field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
    if id.isEmpty {
      defaults.removeObject(forKey: Self.channelKey)
    } else {
      defaults.set(id, forKey: Self.channelKey)
    }
    applyConfigToSaver()
    statusItem.menu = buildMenu()
  }

  @objc private func toggleDefault(_ sender: NSMenuItem) {
    guard let key = sender.representedObject as? String else { return }
    let current = sender.state == .on  // reflects the value shown
    defaults.set(!current, forKey: key)
    statusItem.menu = buildMenu()
  }

  @objc private func setDisplaySaver(_ sender: NSMenuItem) {
    guard let info = sender.representedObject as? [String: String],
      let key = info["display"]
    else { return }
    var dict = perDisplaySaver
    let saverId = info["saver"] ?? ""
    if saverId.isEmpty { dict.removeValue(forKey: key) } else { dict[key] = saverId }
    defaults.set(dict, forKey: Self.perDisplayKey)
    applyConfigToSaver()
    statusItem.menu = buildMenu()
  }

  @objc private func setActiveHours(_ sender: NSMenuItem) {
    guard let pair = sender.representedObject as? [Int], pair.count == 2 else { return }
    defaults.set(pair[0], forKey: Self.activeStartKey)
    defaults.set(pair[1], forKey: Self.activeEndKey)
    statusItem.menu = buildMenu()
  }

  @objc private func toggleHotkey(_ sender: NSMenuItem) {
    defaults.set(sender.state != .on, forKey: Self.hotkeyEnabledKey)
    applyTriggers()
    statusItem.menu = buildMenu()
  }

  @objc private func setHotCorner(_ sender: NSMenuItem) {
    defaults.set(sender.representedObject as? String ?? "", forKey: Self.hotCornerKey)
    applyTriggers()
    statusItem.menu = buildMenu()
  }

  @objc private func toggleLaunchAtLogin(_ sender: NSMenuItem) {
    do {
      if SMAppService.mainApp.status == .enabled {
        try SMAppService.mainApp.unregister()
      } else {
        try SMAppService.mainApp.register()
      }
    } catch {
      NSLog("launch-at-login toggle failed: \(error)")
    }
    statusItem.menu = buildMenu()
  }

  @objc private func castToChannel(_ sender: NSMenuItem) {
    guard let saverId = saver.castableSaverId else {
      alert("Nothing to cast", "No bundled saver is available.")
      return
    }
    let alert = NSAlert()
    alert.messageText = "Cast \(saverId) to a channel"
    alert.informativeText =
      "Publishes this saver to an idlescreens.com channel so other screens mirror it. Enter a channel id (e.g. default, lobby, studio)."
    let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 240, height: 24))
    field.stringValue = defaults.string(forKey: Self.channelKey) ?? "default"
    alert.accessoryView = field
    alert.addButton(withTitle: "Cast")
    alert.addButton(withTitle: "Cancel")
    NSApp.activate(ignoringOtherApps: true)
    guard alert.runModal() == .alertFirstButtonReturn else { return }
    let channel = field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !channel.isEmpty else { return }
    ChannelClient.cast(
      saverId: saverId, channelId: channel, seed: UInt32.random(in: 0...UInt32.max)
    ) { [weak self] success, message in
      guard let self else { return }
      if success {
        self.defaults.set(channel, forKey: Self.castChannelKey)
        self.setStatusIcon("antenna.radiowaves.left.and.right")
        self.statusItem.menu = self.buildMenu()  // reveal "Stop Casting"
      }
      self.alert("Cast", message)
    }
  }

  @objc private func checkForUpdates(_ sender: NSMenuItem) {
    BundleManager.shared.checkForUpdates { [weak self] updated, message in
      guard let self else { return }
      self.defaults.set(Date().timeIntervalSince1970, forKey: Self.lastUpdateCheckKey)
      if updated { self.applyUpdatedBundle() }
      self.alert("Saver Updates", message)
    }
  }

  /// Silent weekly check on launch; installs in the background and defers the
  /// user-facing toast until the saver next shows.
  private func maybeAutoCheckForUpdates() {
    let last = defaults.double(forKey: Self.lastUpdateCheckKey)
    let weekSeconds: TimeInterval = 7 * 24 * 3600
    guard last == 0 || Date().timeIntervalSince1970 - last > weekSeconds else { return }
    BundleManager.shared.checkForUpdates { [weak self] updated, message in
      guard let self else { return }
      self.defaults.set(Date().timeIntervalSince1970, forKey: Self.lastUpdateCheckKey)
      if updated {
        self.applyUpdatedBundle()
        self.defaults.set(message, forKey: Self.pendingUpdateToastKey)
      }
    }
  }

  private func applyUpdatedBundle() {
    // New savers.json → refresh cycle catalog, regenerate thumbnails, rebuild menu.
    applyConfigToSaver()
    thumbnails.generateMissing(ids: liveIds)
    statusItem.menu = buildMenu()
  }

  private var isCasting: Bool {
    !(defaults.string(forKey: Self.castChannelKey) ?? "").isEmpty
  }

  @objc private func stopCasting(_ sender: NSMenuItem) {
    defaults.removeObject(forKey: Self.castChannelKey)
    setStatusIcon(saver.isShowing ? "display.fill" : "display")
    statusItem.menu = buildMenu()
  }

  @objc private func resetBundle(_ sender: NSMenuItem) {
    BundleManager.shared.resetToShipped()
    applyUpdatedBundle()
    alert("Saver Updates", "Reverted to the built-in savers.")
  }

  @objc private func showDiagnostics(_ sender: NSMenuItem) {
    alert("idle-screens Diagnostics", Diagnostics.report(thumbnails: thumbnails))
  }

  private func setStatusIcon(_ symbol: String) {
    statusItem.button?.image = NSImage(
      systemSymbolName: symbol, accessibilityDescription: "idle-screens")
  }

  private func toggleFavorite(_ id: String) {
    var favs = Set(defaults.stringArray(forKey: Self.favoritesKey) ?? [])
    if favs.contains(id) { favs.remove(id) } else { favs.insert(id) }
    defaults.set(Array(favs), forKey: Self.favoritesKey)
    applyConfigToSaver()
  }

  private func addHidden(_ id: String) {
    var hid = Set(defaults.stringArray(forKey: Self.hiddenKey) ?? [])
    hid.insert(id)
    defaults.set(Array(hid), forKey: Self.hiddenKey)
    var favs = Set(defaults.stringArray(forKey: Self.favoritesKey) ?? [])
    favs.remove(id)
    defaults.set(Array(favs), forKey: Self.favoritesKey)
    applyConfigToSaver()
  }

  private func alert(_ title: String, _ text: String) {
    let a = NSAlert()
    a.messageText = title
    a.informativeText = text
    a.addButton(withTitle: "OK")
    NSApp.activate(ignoringOtherApps: true)
    a.runModal()
  }

  // MARK: - Conflict warnings

  private func warnIfSystemSaverConflicts() {
    // Host-scoped read of the system screensaver idle timeout. 0 = never.
    let idleTime = CFPreferencesCopyValue(
      "idleTime" as CFString,
      "com.apple.screensaver" as CFString,
      kCFPreferencesCurrentUser,
      kCFPreferencesCurrentHost
    ) as? Int

    guard let idleTime, idleTime > 0, !defaults.bool(forKey: "conflictWarned") else { return }
    defaults.set(true, forKey: "conflictWarned")

    let alert = NSAlert()
    alert.messageText = "macOS screen saver is also enabled"
    alert.informativeText =
      "The system screen saver is set to start after \(idleTime / 60) minutes and may cover idle-screens. Set it to Never in System Settings → Lock Screen for the best experience."
    alert.addButton(withTitle: "OK")
    alert.runModal()
  }

  private func warnIfDisplaySleepsFirst() {
    guard savedThreshold > 0, let sleep = SystemInfo.displaySleepSeconds, sleep < savedThreshold,
      !defaults.bool(forKey: "displaySleepWarned")
    else { return }
    defaults.set(true, forKey: "displaySleepWarned")

    let alert = NSAlert()
    alert.messageText = "Display sleeps before the saver starts"
    alert.informativeText =
      "Your display is set to sleep after \(Int(sleep / 60)) minutes, but the saver starts after \(Int(savedThreshold / 60)). The saver won't appear. Increase the display-sleep delay in System Settings → Displays, or lower the saver's Start After time."
    alert.addButton(withTitle: "OK")
    alert.runModal()
  }
}
