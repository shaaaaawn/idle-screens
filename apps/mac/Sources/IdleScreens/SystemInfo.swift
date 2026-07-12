import AppKit
import Foundation
import IOKit.ps
import IOKit.pwr_mgt

/// Read-only system power/energy state. No permissions required.
enum SystemInfo {
  /// True when another app appears to be in native fullscreen (presentation,
  /// fullscreen video call/player). Heuristic: any normal-layer window (not
  /// ours) whose size matches a full display — only true fullscreen covers the
  /// menu-bar area, so a zoomed/maximized window won't match. Needs no
  /// Screen Recording permission (window geometry is not window contents).
  static var fullscreenAppPresent: Bool {
    let ourPID = NSRunningApplication.current.processIdentifier
    guard
      let info = CGWindowListCopyWindowInfo(
        [.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
        as? [[String: Any]]
    else { return false }
    let sizes = NSScreen.screens.map { $0.frame.size }
    for w in info {
      guard let layer = w[kCGWindowLayer as String] as? Int, layer == 0,
        let pid = w[kCGWindowOwnerPID as String] as? pid_t, pid != ourPID,
        let b = w[kCGWindowBounds as String] as? [String: CGFloat],
        let width = b["Width"], let height = b["Height"]
      else { continue }
      for size in sizes where abs(width - size.width) < 2 && abs(height - size.height) < 2 {
        return true
      }
    }
    return false
  }
  /// True when running on battery (not plugged in).
  static var isOnBattery: Bool {
    guard let snapshot = IOPSCopyPowerSourcesInfo()?.takeRetainedValue() else { return false }
    guard let type = IOPSGetProvidingPowerSourceType(snapshot)?.takeRetainedValue() as String?
    else { return false }
    return type == kIOPMBatteryPowerKey
  }

  /// Display-sleep timeout for the active power source, in seconds. nil = never
  /// or unknown. Used to warn when the display would sleep before the saver's
  /// idle threshold (so the saver would never appear). Parsed from `pmset -g`,
  /// whose "displaysleep" line reflects the current power source's setting.
  static var displaySleepSeconds: TimeInterval? {
    let proc = Process()
    proc.executableURL = URL(fileURLWithPath: "/usr/bin/pmset")
    proc.arguments = ["-g"]
    let pipe = Pipe()
    proc.standardOutput = pipe
    proc.standardError = FileHandle.nullDevice
    do { try proc.run() } catch { return nil }
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    proc.waitUntilExit()
    guard let out = String(data: data, encoding: .utf8) else { return nil }
    for line in out.split(separator: "\n") {
      let parts = line.split(whereSeparator: { $0 == " " || $0 == "\t" }).filter { !$0.isEmpty }
      if parts.first == "displaysleep", parts.count >= 2, let mins = Int(parts[1]), mins > 0 {
        return TimeInterval(mins * 60)
      }
    }
    return nil
  }
}
