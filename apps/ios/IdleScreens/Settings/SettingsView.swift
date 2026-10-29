import SwiftUI

/// Everything this app holds on your behalf: the screens it can push to, the
/// keys on its ring, who you follow, and how it looks.
///
/// There are no accounts. "You" is the contents of this page — the keys and
/// follows live on this device and in iCloud Keychain, and each drill-in says
/// what happens if you remove something.
struct SettingsView: View {
    @Environment(AppState.self) private var app
    @AppStorage(Appearance.storageKey) private var appearance: Appearance = Appearance.defaultValue

    var body: some View {
        NavigationStack {
            List {
                ListColumnTitle(title: "settings")

                Section {
                    NavigationLink { PairedTVView(embedded: true) } label: {
                        SettingsLabel(title: "Screens", icon: "tv", tint: .blue, detail: screensDetail)
                    }
                    if app.isSyncing {
                        HStack {
                            SettingsLabel(title: "Syncing \(app.syncTargets.count == 1 ? "1 screen" : "\(app.syncTargets.count) screens")",
                                          icon: "dot.radiowaves.left.and.right", tint: .green)
                            Button("Stop") { withAnimation { app.stopSync() } }
                                .buttonStyle(.bordered)
                                .controlSize(.small)
                        }
                    }
                } footer: {
                    Text("Apple TV, Mac and Linux screens you can send channels to.")
                }
                .houseRow()

                Section {
                    NavigationLink { KeysView() } label: {
                        HStack {
                            SettingsLabel(title: "Keys", icon: "key.fill", tint: .orange,
                                          detail: app.credentials.isEmpty ? "None" : "\(app.credentials.count)")
                            // Worth seeing from here: a key that is not on this device.
                            if missingKeys > 0 {
                                Image(systemName: "exclamationmark.triangle.fill")
                                    .foregroundStyle(Color.appDanger)
                                    .accessibilityLabel("\(missingKeys) missing")
                            }
                        }
                    }
                    NavigationLink { FollowingView() } label: {
                        SettingsLabel(title: "Following", icon: "heart.fill", tint: .pink,
                                      detail: app.follows.followed.isEmpty ? "None" : "\(app.follows.followed.count)")
                    }
                    // Report → Hide. Only once there is one: an empty
                    // "hidden" row would read as an accusation.
                    if !app.hidden.ids.isEmpty {
                        NavigationLink { HiddenChannelsView() } label: {
                            SettingsLabel(title: "Hidden", icon: "eye.slash.fill", tint: .gray,
                                          detail: "\(app.hidden.ids.count)")
                        }
                    }
                } header: {
                    Text("Channels")
                } footer: {
                    Text("Keys let you steer a channel; they sync through iCloud Keychain.")
                }
                .houseRow()

                Section {
                    AppearancePicker(selection: $appearance)
                } header: {
                    Text("Appearance")
                } footer: {
                    Text("Watch always plays dark — it's a screen.")
                }
                .houseRow()

                Section("Help") {
                    if let url = Self.link("/support") {
                        ExternalLinkRow(title: "Support", icon: "questionmark", tint: .green, url: url)
                    }
                    if let url = Self.mailURL {
                        // App Review expects a way to report content from
                        // inside the app.
                        ExternalLinkRow(title: "Report content or email us", icon: "envelope.fill", tint: .blue, url: url)
                    }
                }
                .houseRow()

                Section {
                    // Only worth a row on a build pointed somewhere else.
                    if Self.serverHost != "idlescreens.com" {
                        LabeledContent("Server", value: Self.serverHost)
                    }
                    if let url = Self.link("/") {
                        ExternalLinkRow(title: "idlescreens.com", icon: "safari", tint: .indigo, url: url)
                    }
                    // App Store Connect requires both policies to be reachable.
                    if let url = Self.link("/privacy") {
                        ExternalLinkRow(title: "Privacy policy", icon: "hand.raised.fill", tint: .gray, url: url)
                    }
                    if let url = Self.link("/terms") {
                        ExternalLinkRow(title: "Terms of use", icon: "doc.text.fill", tint: .gray, url: url)
                    }
                } header: {
                    Text("About")
                } footer: {
                    Text("Version \(Self.version). No account, no sign-in — what you see here lives on this \(ThisDevice.noun).")
                }
                .houseRow()
            }
            .houseList()
            // Screen presence and channel names are the two things here that
            // go stale.
            .refreshable {
                async let screens: Void = app.refreshScreenStatuses()
                async let gallery: Void = app.loadGallery()
                _ = await (screens, gallery)
            }
            .modifier(ColumnTitle(title: "settings"))
        }
    }

    private var screensDetail: String {
        let screens = app.pairedScreens
        guard !screens.isEmpty else { return "None" }
        let connected = screens.filter { $0.presence() == .connected }.count
        return connected > 0 ? "\(connected) of \(screens.count) on" : "\(screens.count)"
    }

    private var missingKeys: Int {
        app.credentials.filter { app.token(for: $0.channelId) == nil }.count
    }

    private static var serverHost: String { URL(string: Config.baseURL)?.host ?? Config.baseURL }

    private static func link(_ path: String) -> URL? {
        let base = Config.baseURL.hasSuffix("/") ? String(Config.baseURL.dropLast()) : Config.baseURL
        return URL(string: base + (path == "/" ? "" : path))
    }

    private static var mailURL: URL? {
        let subject = "idle screens \(version)".addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        return URL(string: "mailto:support@idlescreens.com?subject=\(subject)")
    }

    private static var version: String {
        let info = Bundle.main.infoDictionary
        let short = info?["CFBundleShortVersionString"] as? String ?? "—"
        let build = info?["CFBundleVersion"] as? String ?? "—"
        return "\(short) (\(build))"
    }
}
