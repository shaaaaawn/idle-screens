import SwiftUI

/// Quality-tier override and manual channel entry.
struct SettingsView: View {
    @Environment(TVAppState.self) private var app
    @State private var channelId = ""

    var body: some View {
        @Bindable var app = app

        NavigationStack {
            Form {
                Section("Rendering") {
                    Picker("Quality tier", selection: $app.tierOverride) {
                        Text("Auto (\(app.detectedTier.rawValue))").tag(CapabilityTier?.none)
                        ForEach(CapabilityTier.allCases, id: \.self) { tier in
                            Text(tierLabel(tier)).tag(CapabilityTier?.some(tier))
                        }
                    }
                    LabeledContent("Hardware", value: app.machine)
                    LabeledContent("Detected tier", value: app.detectedTier.rawValue)
                    LabeledContent("Effective tier", value: app.effectiveTier.rawValue)
                }

                Section("iPhone") {
                    NavigationLink("Pair iPhone") {
                        PairView()
                    }
                }

                Section("Channel") {
                    TextField("Channel ID", text: $channelId)
                    Button("Watch") {
                        let id = channelId.trimmingCharacters(in: .whitespaces)
                        if !id.isEmpty { app.selectChannel(id) }
                    }
                    .disabled(channelId.trimmingCharacters(in: .whitespaces).isEmpty)
                }

                Section("Connection") {
                    LabeledContent("Server", value: app.serverHost)
                    // The id a paired phone addresses switch pushes to —
                    // the first thing to compare when pairing misbehaves.
                    LabeledContent("Device ID", value: app.deviceId)
                    LabeledContent("Last channel", value: app.lastChannelId)
                    Button("Refresh channels") {
                        Task { await app.loadGallery() }
                    }
                }

                Section("About") {
                    LabeledContent("Version", value: appVersion)
                }
            }
            .navigationTitle("Settings")
        }
    }

    private var appVersion: String {
        let short = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?"
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "?"
        return "\(short) (\(build))"
    }

    private func tierLabel(_ tier: CapabilityTier) -> String {
        switch tier {
        case .t3: return "T3 — native canvas 60fps"
        case .t2: return "T2 — GPU sprites 30fps"
        case .t1: return "T1 — thumbnail stream"
        case .t0: return "T0 — braille floor"
        }
    }
}
