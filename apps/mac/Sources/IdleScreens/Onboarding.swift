import AppKit
import ServiceManagement

/// One-time welcome window: explains the menu-bar model and offers one-click
/// setup (disable the system saver hint, enable launch-at-login).
final class Onboarding: NSObject {
  private var window: NSWindow?
  private let defaults = UserDefaults.standard
  private static let doneKey = "onboardingDone"

  var onFinish: (() -> Void)?

  static var shouldShow: Bool {
    !UserDefaults.standard.bool(forKey: doneKey)
  }

  func show() {
    guard window == nil else { window?.makeKeyAndOrderFront(nil); return }

    let content = NSView(frame: NSRect(x: 0, y: 0, width: 460, height: 340))

    let title = label("Welcome to idle-screens", size: 20, weight: .semibold)
    title.frame = NSRect(x: 32, y: 280, width: 396, height: 28)
    content.addSubview(title)

    let body = label(
      """
      idle-screens lives in your menu bar (the display icon), not in a Dock \
      window. It shows a saver when your Mac goes idle.

      • Click the menu-bar icon to pick a saver or start one now.
      • It runs entirely on your Mac — no account, no network required.
      """, size: 13, weight: .regular)
    body.frame = NSRect(x: 32, y: 150, width: 396, height: 120)
    (body as? NSTextField)?.maximumNumberOfLines = 0
    content.addSubview(body)

    let loginToggle = NSButton(
      checkboxWithTitle: "Launch idle-screens at login", target: self,
      action: #selector(toggleLogin(_:)))
    loginToggle.frame = NSRect(x: 32, y: 108, width: 396, height: 20)
    loginToggle.state = SMAppService.mainApp.status == .enabled ? .on : .off
    content.addSubview(loginToggle)

    let hint = label(
      "Tip: set the macOS screen saver to “Never” in System Settings → Lock Screen so the two don't overlap.",
      size: 11, weight: .regular)
    hint.frame = NSRect(x: 32, y: 56, width: 396, height: 40)
    (hint as? NSTextField)?.maximumNumberOfLines = 0
    (hint as? NSTextField)?.textColor = .secondaryLabelColor
    content.addSubview(hint)

    let done = NSButton(title: "Get Started", target: self, action: #selector(finish(_:)))
    done.frame = NSRect(x: 338, y: 16, width: 100, height: 30)
    done.bezelStyle = .rounded
    done.keyEquivalent = "\r"
    content.addSubview(done)

    let win = NSWindow(
      contentRect: content.frame, styleMask: [.titled, .closable],
      backing: .buffered, defer: false)
    win.title = "idle-screens"
    win.contentView = content
    win.center()
    win.isReleasedWhenClosed = false
    window = win

    NSApp.activate(ignoringOtherApps: true)
    win.makeKeyAndOrderFront(nil)
  }

  private func label(_ text: String, size: CGFloat, weight: NSFont.Weight) -> NSView {
    let field = NSTextField(labelWithString: text)
    field.font = .systemFont(ofSize: size, weight: weight)
    field.lineBreakMode = .byWordWrapping
    return field
  }

  @objc private func toggleLogin(_ sender: NSButton) {
    do {
      if sender.state == .on {
        try SMAppService.mainApp.register()
      } else {
        try SMAppService.mainApp.unregister()
      }
    } catch {
      NSLog("onboarding launch-at-login failed: \(error)")
    }
  }

  @objc private func finish(_ sender: NSButton) {
    defaults.set(true, forKey: Self.doneKey)
    window?.close()
    window = nil
    onFinish?()
  }
}
