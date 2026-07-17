import AppKit
import Metal

/// Gathers a human-readable snapshot of app + system state for the Diagnostics
/// menu item. All reads are permissionless.
enum Diagnostics {
  static func report(thumbnails: ThumbnailRenderer) -> String {
    var lines: [String] = []

    let version =
      Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "dev"
    lines.append("Version: \(version)")

    let screens = NSScreen.screens
    lines.append("Displays: \(screens.count)")
    for (i, s) in screens.enumerated() {
      let name = s.localizedName.isEmpty ? "Display \(i + 1)" : s.localizedName
      let f = s.frame
      lines.append("  • \(name) — \(Int(f.width))×\(Int(f.height)) @\(Int(s.backingScaleFactor))x")
    }

    lines.append("Idle: \(Int(IdleMonitor.secondsIdle))s")
    lines.append("Power: \(SystemInfo.isOnBattery ? "battery" : "AC")")
    if let sleep = SystemInfo.displaySleepSeconds {
      lines.append("Display sleep: \(Int(sleep / 60)) min")
    } else {
      lines.append("Display sleep: never")
    }
    lines.append("Fullscreen app present: \(SystemInfo.fullscreenAppPresent ? "yes" : "no")")

    // System screensaver conflict.
    let sysIdle = CFPreferencesCopyValue(
      "idleTime" as CFString, "com.apple.screensaver" as CFString,
      kCFPreferencesCurrentUser, kCFPreferencesCurrentHost) as? Int
    if let sysIdle, sysIdle > 0 {
      lines.append("⚠︎ macOS screen saver: \(sysIdle / 60) min (may conflict)")
    } else {
      lines.append("macOS screen saver: off")
    }

    // GPU tier.
    if let device = MTLCreateSystemDefaultDevice() {
      lines.append("GPU: \(device.name)\(device.isLowPower ? " (low power)" : "")")
    } else {
      lines.append("GPU: none (canvas2d only)")
    }

    let (count, bytes) = thumbnails.cacheInfo()
    let mb = Double(bytes) / 1_048_576
    lines.append("Thumbnails: \(count) cached (\(String(format: "%.1f", mb)) MB)")
    lines.append("Bundle: \(BundleManager.shared.source)")

    return lines.joined(separator: "\n")
  }
}
