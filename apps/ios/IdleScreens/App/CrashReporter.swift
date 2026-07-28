import Foundation
import MetricKit

/// Captures crash/hang diagnostics so a device-only failure isn't invisible.
///
/// MetricKit hands over the *previous* run's diagnostics shortly after launch
/// (crashes, hangs, CPU-exception kills). We persist a compact summary — type,
/// termination reason, top frames — plus a breadcrumb naming the channel that
/// was on screen, so a repeat crash can be tied to a specific scene instead of
/// guessed at.
///
/// Inspect with:
/// `xcrun simctl launch <device> com.hermosalabs.idlescreens -print-diagnostics`
@MainActor
final class CrashReporter: NSObject {
    static let shared = CrashReporter()

    private let breadcrumbKey = "diagnostics.lastRenderedChannel"
    private let loadKey = "diagnostics.renderLoadAtExit"

    private var fileURL: URL {
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        return dir.appendingPathComponent("diagnostics.json")
    }

    func start() {
        MXMetricManager.shared.add(self)
    }

    /// Breadcrumb: what's rendering right now. A crash report is far more
    /// actionable when it names the scene and how heavy it was.
    func noteRendering(channelId: String?, entityCount: Int? = nil) {
        UserDefaults.standard.set(channelId, forKey: breadcrumbKey)
        if let entityCount {
            UserDefaults.standard.set(entityCount, forKey: loadKey)
        }
    }

    func storedReports() -> [[String: Any]] {
        guard let data = try? Data(contentsOf: fileURL),
              let list = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
        else { return [] }
        return list
    }

    func printReports() {
        let reports = storedReports()
        guard !reports.isEmpty else {
            print("diagnostics: none captured yet")
            return
        }
        for report in reports {
            print("—", report["type"] ?? "?", "|", report["reason"] ?? "",
                  "| channel:", report["channel"] ?? "unknown",
                  "| entities:", report["entitiesAtExit"] ?? 0)
            (report["frames"] as? [String])?.prefix(6).forEach { print("   ", $0) }
        }
    }

    fileprivate func record(type: String, reason: String, frames: [String]) {
        let report: [String: Any] = [
            "type": type,
            "reason": reason,
            "at": ISO8601DateFormatter().string(from: Date()),
            "channel": UserDefaults.standard.string(forKey: breadcrumbKey) ?? "unknown",
            "entitiesAtExit": UserDefaults.standard.integer(forKey: loadKey),
            "frames": frames,
        ]
        var all = storedReports()
        all.insert(report, at: 0)
        all = Array(all.prefix(20))
        if let data = try? JSONSerialization.data(withJSONObject: all, options: .prettyPrinted) {
            try? data.write(to: fileURL, options: .atomic)
        }
        NSLog("[idle-screens] diagnostic captured: %@ — %@ (channel %@)",
              type, reason, report["channel"] as? String ?? "unknown")
    }
}

/// Plain, Sendable summary lifted out of MetricKit's non-Sendable payloads
/// before hopping to the main actor.
private struct CapturedDiagnostic: Sendable {
    let type: String
    let reason: String
    let frames: [String]
}

extension CrashReporter: MXMetricManagerSubscriber {
    nonisolated func didReceive(_ payloads: [MXMetricPayload]) {
        // Aggregate performance metrics aren't needed for crash triage.
    }

    nonisolated func didReceive(_ payloads: [MXDiagnosticPayload]) {
        func frames(_ tree: MXCallStackTree?) -> [String] {
            guard let data = tree?.jsonRepresentation(),
                  let text = String(data: data, encoding: .utf8) else { return [] }
            return text.components(separatedBy: "\"binaryName\"")
                .dropFirst()
                .prefix(8)
                .map { String($0.prefix(80)) }
        }

        var captured: [CapturedDiagnostic] = []
        for payload in payloads {
            for crash in payload.crashDiagnostics ?? [] {
                captured.append(CapturedDiagnostic(
                    type: "crash",
                    reason: crash.terminationReason ?? "signal \(crash.signal?.stringValue ?? "?")",
                    frames: frames(crash.callStackTree)))
            }
            for hang in payload.hangDiagnostics ?? [] {
                captured.append(CapturedDiagnostic(
                    type: "hang",
                    reason: "\(hang.hangDuration.value)\(hang.hangDuration.unit.symbol)",
                    frames: frames(hang.callStackTree)))
            }
            for kill in payload.cpuExceptionDiagnostics ?? [] {
                captured.append(CapturedDiagnostic(
                    type: "cpu-exception",
                    reason: "\(kill.totalCPUTime.value)\(kill.totalCPUTime.unit.symbol)",
                    frames: frames(kill.callStackTree)))
            }
        }

        let snapshot = captured
        Task { @MainActor in
            for item in snapshot {
                CrashReporter.shared.record(
                    type: item.type, reason: item.reason, frames: item.frames)
            }
        }
    }
}
