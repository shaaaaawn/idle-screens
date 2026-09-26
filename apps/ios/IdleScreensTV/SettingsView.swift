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
                            Text(Self.tierLabel(tier)).tag(CapabilityTier?.some(tier))
                        }
                    }
                } header: {
                    Text("Picture")
                } footer: {
                    Text(tierFooter)
                }

                Section {
                    Picker("Change channel", selection: $app.rotateMinutes) {
                        Text("Never").tag(0)
                        Text("Every 5 minutes").tag(5)
                        Text("Every 15 minutes").tag(15)
                        Text("Every 30 minutes").tag(30)
                        Text("Every hour").tag(60)
                    }
                    Toggle("Start where I left off", isOn: $app.resumeOnLaunch)
                } header: {
                    Text("Ambient")
                } footer: {
                    Text("Leave it running and it moves through the channels on its own. In the player, Up and Down change channel; Left and Right step through a channel's past.")
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
                    LabeledContent("Rendering at", value: Self.tierLabel(app.effectiveTier))
                    LabeledContent("Graphics budget", value: Self.classLabel(app.renderClass))
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
    static func tierLabel(_ tier: CapabilityTier) -> String {
        switch tier {
        case .t3: return "High — smooth 60fps scenes"
        case .t2: return "Balanced — 30fps scenes"
        case .t1: return "Light — streamed stills"
        case .t0: return "Minimal — text only"
        }
    }

    /// What the box is allowed to spend, as opposed to which renderer it
    /// uses — worth showing because it is the number that changes on newer
    /// hardware.
    static func classLabel(_ renderClass: RenderClass) -> String {
        switch renderClass {
        case .high: return "High — newer Apple TV"
        case .standard: return "Standard — Apple TV 4K"
        case .legacy: return "Reduced — pre-4K Apple TV"
        }
    }

    private var tierFooter: String {
        guard app.tierOverride == nil else {
            return "Fixed by you. Automatic adapts per channel if a scene runs heavy."
        }
        return "Set from this Apple TV (\(app.machine)) and adjusted per channel if a scene runs heavy. Currently \(Self.tierLabel(app.effectiveTier).lowercased())."
    }
}
