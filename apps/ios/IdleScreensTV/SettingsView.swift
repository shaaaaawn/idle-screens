import SwiftUI

/// Settings, in the order someone actually needs them: pair a phone, tune
/// how hard this box works, jump to a channel by id — then diagnostics,
/// which are for us and sit last.
struct SettingsView: View {
    @Environment(TVAppState.self) private var app
    @State private var channelId = ""

    var body: some View {
        @Bindable var app = app

        NavigationStack {
            Form {
                Section {
                    NavigationLink {
                        PairView()
                    } label: {
                        Label("Pair iPhone", systemImage: "iphone.gen3")
                    }
                } header: {
                    Text("Remote")
                } footer: {
                    Text("Scan a code with the idle screens app to switch channels and VJ scenes from your phone.")
                }

                Section {
                    Picker("Quality", selection: $app.tierOverride) {
                        Text("Automatic").tag(CapabilityTier?.none)
                        ForEach(CapabilityTier.allCases, id: \.self) { tier in
                            Text(tierLabel(tier)).tag(CapabilityTier?.some(tier))
                        }
                    }
                } header: {
                    Text("Picture")
                } footer: {
                    Text(tierFooter)
                }

                Section {
                    TextField("Channel ID", text: $channelId)
                    Button("Watch") {
                        let id = channelId.trimmingCharacters(in: .whitespaces)
                        if !id.isEmpty { app.selectChannel(id) }
                    }
                    .disabled(channelId.trimmingCharacters(in: .whitespaces).isEmpty)
                    Button("Refresh channels") {
                        Task { await app.loadGallery() }
                    }
                } header: {
                    Text("Channels")
                } footer: {
                    Text("Open a channel that isn't listed in the gallery — including unlisted ones.")
                }

                Section("Diagnostics") {
                    LabeledContent("Hardware", value: app.machine)
                    LabeledContent("Rendering at", value: tierLabel(app.effectiveTier))
                    LabeledContent("Server", value: app.serverHost)
                    // The id a paired phone addresses switch pushes to —
                    // the first thing to compare when pairing misbehaves.
                    LabeledContent("Device ID", value: app.deviceId)
                    LabeledContent("Last channel", value: app.lastChannelId)
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

    /// Plain language, not tier codes: "T2 — GPU sprites 30fps" told the
    /// viewer nothing about what they would see.
    private func tierLabel(_ tier: CapabilityTier) -> String {
        switch tier {
        case .t3: return "High — smooth 60fps scenes"
        case .t2: return "Balanced — 30fps scenes"
        case .t1: return "Light — streamed stills"
        case .t0: return "Minimal — text only"
        }
    }

    private var tierFooter: String {
        guard app.tierOverride == nil else {
            return "Fixed by you. Automatic adapts per channel if a scene runs heavy."
        }
        return "Set from this Apple TV (\(app.machine)) and adjusted per channel if a scene runs heavy. Currently \(tierLabel(app.effectiveTier).lowercased())."
    }
}
