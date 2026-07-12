import Foundation
import IOKit.ps
import IOKit.pwr_mgt

/// Read-only system power/energy state. No permissions required.
enum SystemInfo {
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
