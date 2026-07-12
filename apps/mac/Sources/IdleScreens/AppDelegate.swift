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

  private let defaults = UserDefaults.standard
  private static let thresholdKey = "idleThresholdSeconds"
  private static let pinnedSaverKey = "pinnedSaver"
  private static let onlyOnPowerKey = "onlyOnPower"
  private static let channelKey = "channelId"

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
    if let button = statusItem.button {
      button.image = NSImage(
        systemSymbolName: "display", accessibilityDescription: "idle-screens")
    }
    statusItem.menu = buildMenu()

    idleMonitor.onIdle = { [weak self] in self?.idleTriggered() }
    idleMonitor.start()

    warnIfSystemSaverConflicts()
    warnIfDisplaySleepsFirst()

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

  private func applyConfigToSaver() {
    saver.pinnedSaver = defaults.string(forKey: Self.pinnedSaverKey)
    let channelId = defaults.string(forKey: Self.channelKey)
    saver.channelURL = channelId.flatMap { id in
      id.isEmpty ? nil : URL(string: "https://idlescreens.com/channel/\(id)")
    }
  }

  private func idleTriggered() {
    if defaults.bool(forKey: Self.onlyOnPowerKey) && SystemInfo.isOnBattery { return }
    saver.show()
  }

  // MARK: - Menu

  private func buildMenu() -> NSMenu {
    let menu = NSMenu()

    let startNow = NSMenuItem(
      title: "Start Screen Saver", action: #selector(startNow(_:)), keyEquivalent: "s")
    startNow.target = self
    menu.addItem(startNow)
    menu.addItem(.separator())

    menu.addItem(saverPickerItem())
    menu.addItem(startAfterItem())
    menu.addItem(contentItem())
    menu.addItem(onlyOnPowerItem())
    menu.addItem(launchAtLoginItem())

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

    for entry in SaverCatalog.all {
      let item = NSMenuItem(title: entry.label, action: #selector(setSaver(_:)), keyEquivalent: "")
      item.target = self
      item.representedObject = entry.id
      item.state = (pinned == entry.id) ? .on : .off
      submenu.addItem(item)
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

  private func onlyOnPowerItem() -> NSMenuItem {
    let item = NSMenuItem(
      title: "Only on Power", action: #selector(toggleOnlyOnPower(_:)), keyEquivalent: "")
    item.target = self
    item.state = defaults.bool(forKey: Self.onlyOnPowerKey) ? .on : .off
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
    saver.show()
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

  @objc private func toggleOnlyOnPower(_ sender: NSMenuItem) {
    defaults.set(!defaults.bool(forKey: Self.onlyOnPowerKey), forKey: Self.onlyOnPowerKey)
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
