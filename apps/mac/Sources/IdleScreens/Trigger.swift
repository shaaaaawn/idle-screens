import AppKit
import Carbon.HIToolbox

/// Global hotkey (⌃⌥⌘S) to start the saver on demand. Uses Carbon
/// RegisterEventHotKey, which needs no Accessibility permission.
final class HotkeyManager {
  private var hotKeyRef: EventHotKeyRef?
  private var handlerRef: EventHandlerRef?
  private let hotKeyID = EventHotKeyID(signature: OSType(0x6964_7363), id: 1)  // 'idsc'
  var onTrigger: (() -> Void)?

  func register() {
    unregister()
    var eventType = EventTypeSpec(
      eventClass: OSType(kEventClassKeyboard), eventKind: OSType(kEventHotKeyPressed))
    let selfPtr = Unmanaged.passUnretained(self).toOpaque()
    InstallEventHandler(
      GetApplicationEventTarget(),
      { _, event, userData -> OSStatus in
        guard let userData, let event else { return noErr }
        let manager = Unmanaged<HotkeyManager>.fromOpaque(userData).takeUnretainedValue()
        var hkID = EventHotKeyID()
        let status = GetEventParameter(
          event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID),
          nil, MemoryLayout<EventHotKeyID>.size, nil, &hkID)
        guard status == noErr, hkID.signature == manager.hotKeyID.signature,
          hkID.id == manager.hotKeyID.id
        else { return noErr }
        manager.onTrigger?()
        return noErr
      }, 1, &eventType, selfPtr, &handlerRef)

    let mods = UInt32(controlKey | optionKey | cmdKey)
    let status = RegisterEventHotKey(
      UInt32(kVK_ANSI_S), mods, hotKeyID, GetApplicationEventTarget(), 0, &hotKeyRef)
    if status != noErr {
      NSLog("HotkeyManager: RegisterEventHotKey failed with status \(status)")
    }
  }

  func unregister() {
    if let hotKeyRef { UnregisterEventHotKey(hotKeyRef); self.hotKeyRef = nil }
    if let handlerRef { RemoveEventHandler(handlerRef); self.handlerRef = nil }
  }
}

enum ScreenCorner: String, CaseIterable {
  case topLeft, topRight, bottomLeft, bottomRight
  var label: String {
    switch self {
    case .topLeft: return "Top Left"
    case .topRight: return "Top Right"
    case .bottomLeft: return "Bottom Left"
    case .bottomRight: return "Bottom Right"
    }
  }
}

/// Hot-corner trigger: park the cursor in a screen corner for ~0.4s to start
/// the saver. A global mouse-moved monitor needs no permission (only key
/// events do).
final class HotCorner {
  private var monitor: Any?
  private var dwellTimer: Timer?
  var corner: ScreenCorner?
  var onTrigger: (() -> Void)?

  func apply() {
    if corner == nil { disable() } else { enable() }
  }

  private func enable() {
    guard monitor == nil else { return }
    monitor = NSEvent.addGlobalMonitorForEvents(matching: [.mouseMoved]) { [weak self] _ in
      self?.check()
    }
  }

  private func disable() {
    if let monitor { NSEvent.removeMonitor(monitor); self.monitor = nil }
    dwellTimer?.invalidate()
    dwellTimer = nil
  }

  private func check() {
    guard let corner else { return }
    let loc = NSEvent.mouseLocation
    guard let screen = NSScreen.screens.first(where: { NSMouseInRect(loc, $0.frame, false) })
    else { return }
    let f = screen.frame
    let m: CGFloat = 3
    let inCorner: Bool
    switch corner {
    case .topLeft: inCorner = loc.x <= f.minX + m && loc.y >= f.maxY - m
    case .topRight: inCorner = loc.x >= f.maxX - m && loc.y >= f.maxY - m
    case .bottomLeft: inCorner = loc.x <= f.minX + m && loc.y <= f.minY + m
    case .bottomRight: inCorner = loc.x >= f.maxX - m && loc.y <= f.minY + m
    }
    if inCorner {
      if dwellTimer == nil {
        dwellTimer = Timer.scheduledTimer(withTimeInterval: 0.4, repeats: false) { [weak self] _ in
          self?.dwellTimer = nil
          self?.onTrigger?()
        }
      }
    } else {
      dwellTimer?.invalidate()
      dwellTimer = nil
    }
  }
}
