import SwiftUI

/// Everything this app holds on your behalf, in one place: the screens it can
/// push to, the keys on its ring, who you follow, and how all of that syncs.
///
/// There are no accounts. "You" is the contents of this page — which is why it
/// says plainly where each thing is stored and what happens if you remove it.
struct SettingsView: View {
    @Environment(AppState.self) private var app
    @State private var showingAddKey = false
    @State private var handoff: TokenHandoff?
    @State private var keysFor: ChannelCredential?
    @State private var removing: ChannelCredential?
    @State private var confirmingRemoval = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 26) {
                    screensSection
                    keysSection
                    followingSection
                    syncSection
                    aboutSection
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 12)
            }
            .background(Color.appBackground.ignoresSafeArea())
            .navigationTitle("settings")
        }
        .sheet(isPresented: $showingAddKey) { AddExistingChannelSheet() }
        .sheet(item: $handoff) { TokenHandoffSheet(handoff: $0) }
        .sheet(item: $keysFor) { ChannelKeysSheet(credential: $0) }
        .alert("Remove the key for \(removing?.label ?? "this channel")?", isPresented: $confirmingRemoval) {
            Button("Remove key", role: .destructive) {
                if let removing { app.removeChannel(removing) }
                removing = nil
            }
            Button("Cancel", role: .cancel) { removing = nil }
        } message: {
            Text("The channel keeps running. Without a backup of this key, this device — and every device synced with it — can no longer steer it.")
        }
    }

    // MARK: Screens

    private var screensSection: some View {
        section("screens", footer: "Apple TVs, Macs and Linux displays you have paired. Push any channel to them from the feed.") {
            NavigationLink {
                PairedTVView(embedded: true)
            } label: {
                HStack {
                    row(icon: "tv.badge.wifi", title: "Screens", detail: screensDetail)
                    Image(systemName: "chevron.right")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Color.textTertiary)
                }
                // Without this only the words are tappable; the gap between
                // "Screens" and the count swallows the tap.
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
    }

    private var screensDetail: String {
        let screens = app.pairedScreens
        guard !screens.isEmpty else { return "none paired" }
        let connected = screens.filter { $0.presence() == .connected }.count
        return connected > 0 ? "\(screens.count) paired · \(connected) connected" : "\(screens.count) paired"
    }

    // MARK: Keys

    private var keysSection: some View {
        section("keys", footer: "A key is what lets you steer a channel. Owner keys can mint and revoke editor and viewer keys to share.") {
            ForEach(app.credentials) { credential in
                keyRow(credential)
                Divider().overlay(Color.appBorder.opacity(0.5))
            }
            Button {
                showingAddKey = true
            } label: {
                Label("Add a key…", systemImage: "plus")
                    .foregroundStyle(Color.appPrimary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
    }

    private func keyRow(_ credential: ChannelCredential) -> some View {
        let token = app.token(for: credential.channelId)
        let role = app.role(for: credential.channelId)
        return Menu {
            if let token {
                Button {
                    handoff = TokenHandoff(credential: credential, token: token)
                } label: { Label("Back up or move this key…", systemImage: "square.and.arrow.up") }
            }
            if role?.canAdminister == true {
                Button { keysFor = credential } label: {
                    Label("Share & keys…", systemImage: "person.2.badge.key")
                }
            }
            Button(role: .destructive) { removing = credential; confirmingRemoval = true } label: {
                Label("Remove from this device", systemImage: "trash")
            }
        } label: {
            HStack(spacing: 12) {
                Image(systemName: token == nil ? "key.slash" : "key.fill")
                    .foregroundStyle(token == nil ? Color.appDanger : Color.appPrimary)
                    .frame(width: 26)
                VStack(alignment: .leading, spacing: 2) {
                    Text(credential.label)
                        .foregroundStyle(Color.textPrimary)
                    Text(token == nil ? "key missing on this device"
                                      : (role?.rawValue ?? "key"))
                        .font(.caption)
                        .foregroundStyle(token == nil ? Color.appDanger : Color.textSecondary)
                }
                Spacer()
                Image(systemName: "ellipsis")
                    .foregroundStyle(Color.textTertiary)
            }
        }
    }

    // MARK: Following

    private var followingSection: some View {
        section("following") {
            let followed = app.follows.followed.sorted()
            if followed.isEmpty {
                Text("Follow a channel from the feed and it shows up first in Channels.")
                    .font(.footnote)
                    .foregroundStyle(Color.textSecondary)
            } else {
                ForEach(followed, id: \.self) { id in
                    HStack {
                        Text(app.channels.first { $0.id == id }?.displayLabel ?? id)
                            .foregroundStyle(Color.textPrimary)
                            .lineLimit(1)
                        Spacer()
                        Button("Unfollow") {
                            withAnimation { _ = app.follows.toggle(id) }
                        }
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Color.appPrimary)
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    // MARK: Sync

    private var syncSection: some View {
        section("sync", footer: "Keys and follows travel with iCloud Keychain to your other Apple devices, end-to-end encrypted — turn it on in iOS Settings → your name → iCloud → Passwords. There is no idle screens account; for anything outside Apple's sync, back a key up from its menu above.") {
            row(icon: "key.icloud", title: "Keys", detail: "iCloud Keychain")
            row(icon: "star", title: "Following", detail: "iCloud Keychain")
            row(icon: "tv", title: "Paired screens", detail: "this device only")
        }
    }

    // MARK: About

    private var aboutSection: some View {
        section("about") {
            row(icon: "info.circle", title: "Version", detail: Self.version)
            row(icon: "server.rack", title: "Server", detail: URL(string: Config.baseURL)?.host ?? Config.baseURL)
            if let site = URL(string: Config.baseURL) {
                Link(destination: site) {
                    row(icon: "safari", title: "Open idlescreens.com", detail: "")
                }
            }
        }
    }

    /// A titled card: header, rows separated by hairlines, optional footnote.
    private func section<Content: View>(_ title: String, footer: String? = nil,
                                        @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color.textSecondary)
            VStack(alignment: .leading, spacing: 14) { content() }
                .settingsCard()
            if let footer {
                Text(footer)
                    .font(.footnote)
                    .foregroundStyle(Color.textTertiary)
            }
        }
    }

    private static var version: String {
        let info = Bundle.main.infoDictionary
        let short = info?["CFBundleShortVersionString"] as? String ?? "—"
        let build = info?["CFBundleVersion"] as? String ?? "—"
        return "\(short) (\(build))"
    }

    private func row(icon: String, title: String, detail: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .foregroundStyle(Color.appPrimary)
                .frame(width: 26)
            Text(title).foregroundStyle(Color.textPrimary)
            Spacer()
            Text(detail)
                .font(.subheadline)
                .foregroundStyle(Color.textSecondary)
                .lineLimit(1)
        }
    }
}

private extension View {
    func settingsCard() -> some View {
        padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.appSurface, in: RoundedRectangle(cornerRadius: 14))
            .overlay {
                RoundedRectangle(cornerRadius: 14)
                    .strokeBorder(Color.appBorder.opacity(0.6), lineWidth: 1)
            }
    }
}
